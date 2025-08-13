import express from "express";
import morgan from "morgan";
import crypto from "crypto";
import qs from "qs";
import pkg from "pg";
const { Pool } = pkg;
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { execSync } from 'child_process';
import os from 'os';

import { readFileSync } from 'fs';
const appPkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));



// Add version info once during startup
let buildInfo = {
  name: appPkg.name || 'backend',
  version: appPkg.version || '0.0.0',
  commit: 'unknown',
  builtAt: new Date().toISOString(),
  env: process.env.NODE_ENV || 'development',
  host: os.hostname()
};

try {
  // get short git hash
  buildInfo.commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch (err) {
  console.warn('[Debug] Could not get git commit hash', err.message);
}



const app = express();
// Global middleware must come before routes (parsers, cookies, logging)
app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: false })); // IPN (form-encoded)
app.use(express.json());
app.use(cookieParser());

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'ChurPay <no-reply@churpay.com>';
const TEST_RECEIPT_TO = process.env.TEST_RECEIPT_TO || '';

let _mailer = null;
async function getTransporter() {
  if (_mailer) return _mailer;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[Mail] SMTP not fully configured — skipping email.');
    return null;
  }
  const secure = SMTP_PORT === 465;
  _mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  try {
    await _mailer.verify();
    console.log('[Mail] transporter verified');
  } catch (e) {
    console.warn('[Mail] transporter verify failed:', e?.message || e);
  }
  return _mailer;
}

async function sendReceiptEmail({ to, amount, reference, status }) {
  try {
    const tx = await getTransporter();
    if (!tx) return { skipped: true };
    const amt = Number(amount || 0);
    const subject = `ChurPay receipt${reference ? ` (${reference})` : ''}`;
    const text =
      `Thank you for your payment.\n\n` +
      `Reference: ${reference || '-'}\n` +
      `Amount: ZAR ${isFinite(amt) ? amt.toFixed(2) : String(amount)}\n` +
      `Status: ${status || '-'}\n\n` +
      `If you have questions, reply to this email.\n— ChurPay`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;line-height:1.45">
        <h2 style="margin:0 0 8px">ChurPay Receipt</h2>
        <p><strong>Reference:</strong> ${reference || '-'}</p>
        <p><strong>Amount:</strong> R ${isFinite(amt) ? amt.toFixed(2) : String(amount)}</p>
        <p><strong>Status:</strong> ${status || '-'}</p>
        <p style="color:#667">This email was sent from the ${process.env.NODE_ENV || 'development'} environment.</p>
      </div>`;
    const info = await tx.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    console.log('[Mail] sent', info.messageId, '→', to);
    return { ok: true };
  } catch (e) {
    console.error('[Mail] send error', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// POST /api/admin/backfill-from-ipn
// Body: { ref: "m_payment_id or merchant_reference" }
// Helper to ensure unique index on merchant_reference exists (for ON CONFLICT to work)
async function ensureMerchantRefUniqueIndex() {
  if (!pool) return;
  try {
    // Prefer a real UNIQUE CONSTRAINT (best for ON CONFLICT)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.payments'::regclass
            AND contype = 'u'
            AND conname = 'payments_merchant_reference_key'
        ) THEN
          ALTER TABLE payments
            ADD CONSTRAINT payments_merchant_reference_key UNIQUE (merchant_reference);
        END IF;
      END
      $$;
    `);

    // Keep the old partial index around if you want (harmless if both exist)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_merchant_reference
        ON payments(merchant_reference)
        WHERE merchant_reference IS NOT NULL;
    `);
  } catch (e) {
    console.warn('[DB] ensureMerchantRefUniqueIndex failed', e?.message || e);
  }

}


// Admin: ensure important indexes exist (idempotent)
app.post('/api/admin/ensure-indexes', requireAuth, requireAdmin, async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'no db' });
  try {
    await ensureMerchantRefUniqueIndex();
    // Report back what we have
    const q = await pool.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE tablename='payments' AND indexname='idx_payments_merchant_reference'`
    );
    return res.json({ ok: true, indexes: q.rows });
  } catch (e) {
    console.error('[admin ensure-indexes]', e);
    return res.status(500).json({ error: 'internal', detail: e?.message || String(e) });
  }
});

// POST /api/admin/backfill-from-ipn
// Body: { ref: "m_payment_id or merchant_reference" }
app.post('/api/admin/backfill-from-ipn', requireAuth, async (req, res) => {
  const { ref } = req.body || {};
  if (!ref) return res.status(400).json({ error: 'ref required' });
  if (!pool) return res.status(500).json({ error: 'no db' });
  try {
    console.log('[admin backfill] START ref=', ref);

    // Ensure the unique index exists so ON CONFLICT works
    await ensureMerchantRefUniqueIndex();

    // 1) Find latest IPN for the reference
    const ipn = await pool.query(
      `SELECT id, pf_payment_id, created_at, raw
         FROM ipn_events
        WHERE (raw->>'m_payment_id') = $1
           OR (raw->>'merchant_reference') = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [ref]
    );

    if (ipn.rowCount === 0) {
      console.log('[admin backfill] no ipn for ref', ref);
      return res.status(404).json({ error: 'no ipn for ref' });
    }

    const ev = ipn.rows[0];
    const raw = ev.raw || {};

    const amount = Number(raw.amount_gross || raw.amount || 0) || 0;
    const payerName = raw.name_first && raw.name_last ? `${raw.name_first} ${raw.name_last}` : (raw.name_first || null);
    const payerEmail = raw.email_address || null;
    const status = (raw.payment_status || 'PENDING').toString().toUpperCase().includes('COMPLETE') ? 'PAID' : 'PENDING';
    const pfId = raw.pf_payment_id || ev.pf_payment_id || null;
    const merchantRef = raw.m_payment_id || raw.merchant_reference || ref;

    console.log('[admin backfill] ipn_row', { ipn_id: ev.id, pfId, merchantRef, amount, status, payerEmail, payerName });

    // 2) Idempotent upsert on merchant_reference (handles retries safely)
    const doUpsert = async () => {
      return pool.query(
        `INSERT INTO payments (merchant_reference, pf_payment_id, amount, status, payer_email, payer_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (merchant_reference) DO UPDATE
         SET pf_payment_id = COALESCE(EXCLUDED.pf_payment_id, payments.pf_payment_id),
             amount        = CASE
                               WHEN payments.amount IS NULL OR payments.amount = 0
                                 THEN EXCLUDED.amount
                               ELSE payments.amount
                             END,
             status        = EXCLUDED.status,
             payer_email   = COALESCE(EXCLUDED.payer_email, payments.payer_email),
             payer_name    = COALESCE(EXCLUDED.payer_name, payments.payer_name)
         RETURNING *`,
        [merchantRef, pfId, amount, status, payerEmail, payerName]
      );
    };

    let upsert;
    try {
      upsert = await doUpsert();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      const code = e?.code || '';
      // Retry once if PG says the ON CONFLICT can't find a unique/exclusion constraint
      if (msg.includes('no unique or exclusion constraint') || code === '42P10') {
        console.warn('[admin backfill] missing unique index on merchant_reference — creating and retrying');
        await ensureMerchantRefUniqueIndex();
        upsert = await doUpsert();
      } else {
        throw e;
      }
    }

    const savedRow = upsert.rows[0];
    console.log('[admin backfill] DONE payment_id=', savedRow?.id);
    return res.json({ ok: true, payment: savedRow, ipn_id: ev.id });
  } catch (e) {
    console.error('[admin backfill] ERROR', e);
    return res.status(500).json({ error: 'internal', detail: e?.message || String(e), code: e?.code });
  }
});


// ------------------ end Mailer setup ------------------
app.use((req, res, next) => {
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  // Always signal credentials support
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    const reqHdrs = req.headers['access-control-request-headers'];
    res.header('Access-Control-Allow-Headers', reqHdrs || 'Content-Type, Authorization');
    return res.sendStatus(204);
  }
  next();
});

// Explicit preflight for API paths to ensure credentials header is present behind proxies
app.options(['/api/*', '/api/auth/*'], (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const reqHdrs = req.headers['access-control-request-headers'];
  res.header('Access-Control-Allow-Headers', reqHdrs || 'Content-Type, Authorization');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Max-Age', '600');
  return res.sendStatus(204);
});

// CORS debug route: returns info about CORS headers for the current request
app.get('/api/debug/cors', (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.json({
    origin,
    allowedOrigins: ALLOWED_ORIGINS,
    responseHeaders: {
      'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials')
    }
  });
});

// Debug: list registered routes (methods + path)
function collectRoutes(app) {
  const out = [];
  const add = (route) => {
    const methods = Object.keys(route.methods || {}).map(m => m.toUpperCase());
    out.push({ methods, path: route.path });
  };
  const scanStack = (stack) => {
    (stack || []).forEach((layer) => {
      if (layer.route) {
        add(layer.route);
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        scanStack(layer.handle.stack);
      }
    });
  };
  if (app._router && app._router.stack) scanStack(app._router.stack);
  return out;
}
app.get('/api/debug/routes', (req, res) => {
  const routes = collectRoutes(app);
  res.json({ count: routes.length, routes });
});
// Version info endpoint
app.get('/api/debug/version', (req, res) => {
  res.json(buildInfo);
});

// other middleware and routes below...
// -------------------- Settings API --------------------
let APP_SETTINGS = {
  brandColor: process.env.BRAND_COLOR || "#6b4fff",
  sandboxMode: true,
};

async function dbEnsureSettingsTable() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    id INT PRIMARY KEY,
    brand_color TEXT,
    sandbox_mode BOOLEAN
  )`);
}

async function dbGetSettings() {
  if (!pool) return null;
  try {
    await dbEnsureSettingsTable();
    const { rows } = await pool.query(
      "SELECT brand_color, sandbox_mode FROM app_settings WHERE id=1"
    );
    if (rows.length)
      return {
        brandColor: rows[0].brand_color || "#6b4fff",
        sandboxMode: !!rows[0].sandbox_mode,
      };
    return null;
  } catch (e) {
    console.log("[Settings][DB] get error", e.message);
    return null;
  }
}

async function dbSetSettings(brandColor, sandboxMode) {
  if (!pool) return false;
  try {
    await dbEnsureSettingsTable();
    await pool.query(
      `INSERT INTO app_settings (id, brand_color, sandbox_mode)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET brand_color=EXCLUDED.brand_color, sandbox_mode=EXCLUDED.sandbox_mode`,
      [brandColor, sandboxMode]
    );
    return true;
  } catch (e) {
    console.log("[Settings][DB] set error", e.message);
    return false;
  }
}

app.get("/api/settings", async (req, res) => {
  const db = await dbGetSettings();
  if (db) return res.json(db);
  return res.json(APP_SETTINGS);
});

app.post("/api/settings", async (req, res) => {
  const { brandColor, sandboxMode } = req.body || {};
  const hexOk =
    typeof brandColor === "string" &&
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brandColor);
  const boolOk = typeof sandboxMode === "boolean";
  if (!hexOk || !boolOk) return res.status(400).json({ error: "invalid" });

  const ok = await dbSetSettings(brandColor, sandboxMode);
  if (!ok) APP_SETTINGS = { brandColor, sandboxMode };
  return res.json({ ok: true });
});
// ------------------ end Settings API ------------------

// --- Postgres (Render) optional setup ---
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("render.com") || DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : false,
  });
  // --- Simple migrations runner (versioned, idempotent) ---
  async function runMigrations() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      const MIGRATIONS = [
        {
          version: '001_init_schema',
          sql: `
            CREATE TABLE IF NOT EXISTS payments (
              id SERIAL PRIMARY KEY,
              pf_payment_id TEXT UNIQUE,
              amount NUMERIC(12,2),
              status TEXT,
              merchant_reference TEXT,
              payer_email TEXT,
              payer_name TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ipn_events (
              id SERIAL PRIMARY KEY,
              pf_payment_id TEXT,
              raw JSONB,
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS users (
              id SERIAL PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT DEFAULT 'admin',
              created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS app_settings (
              id INT PRIMARY KEY,
              brand_color TEXT,
              sandbox_mode BOOLEAN
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_pf_payment_id
              ON payments(pf_payment_id) WHERE pf_payment_id IS NOT NULL;
          `,
        },
        {
          version: '002_payments_columns_guard',
          sql: `
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS merchant_reference TEXT;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_email TEXT;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_name TEXT;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS pf_payment_id TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_pf_payment_id
              ON payments(pf_payment_id) WHERE pf_payment_id IS NOT NULL;
          `,
        },
                {
          version: '003_payments_notes_tags',
          sql: `
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS note TEXT;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS tags TEXT[];
          `,
        },
        {
  version: '004_payments_unique_merchant_reference',
  sql: `
    -- Ensure fast lookup and enable ON CONFLICT on merchant_reference
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_merchant_reference
      ON payments(merchant_reference)
      WHERE merchant_reference IS NOT NULL;
  `,
},

{
  version: '005_unique_constraint_merchant_reference',
  sql: `
    -- Remove the partial index if it exists (safe)
    DROP INDEX IF EXISTS idx_payments_merchant_reference;

    -- Add a true UNIQUE CONSTRAINT (works with ON CONFLICT reliably)
    ALTER TABLE payments
      ADD CONSTRAINT payments_merchant_reference_key UNIQUE (merchant_reference);
  `,
},
      ];

      
      

      for (const m of MIGRATIONS) {
        const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', [m.version]);
        if (rows.length) { console.log('[DB][migrate] skip', m.version); continue; }
        console.log('[DB][migrate] apply', m.version);
        await pool.query('BEGIN');
        try {
          await pool.query(m.sql);
          await pool.query('INSERT INTO schema_migrations(version) VALUES($1)', [m.version]);
          await pool.query('COMMIT');
          console.log('[DB][migrate] done', m.version);
        } catch (e) {
          await pool.query('ROLLBACK');
          console.error('[DB][migrate] failed', m.version, e);
          throw e;
        }
      }
      console.log('[DB] migrations complete');
    } catch (err) {
      console.error('[DB] migration error', err);
    }
  }

  // Run migrations at boot
  await runMigrations();
} else {
  console.warn("[DB] No DATABASE_URL configured — /api/payments will return []");
}

app.get("/", (_req, res) => res.json({ message: "Churpay Backend is running" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "backend" }));
// Simple version endpoint (duplicate of debug version info)
app.get("/api/version", (_req, res) => res.json(buildInfo));
app.get("/api/payments", async (req, res) => {
  try {
    if (!pool) {
      return res.status(200).json([]);
    }
    const ref = (req.query.ref || '').toString().trim();
   if (ref) {
  const { rows } = await pool.query(
    `SELECT id, pf_payment_id, amount::float8 AS amount, status, merchant_reference, payer_email, payer_name, note, tags, created_at
     FROM payments
     WHERE merchant_reference = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [ref]
  );
  return res.status(200).json(rows);
} else {
  const { rows } = await pool.query(
    `SELECT id, pf_payment_id, amount::float8 AS amount, status, merchant_reference, payer_email, payer_name, note, tags, created_at
     FROM payments
     ORDER BY created_at DESC
     LIMIT 100`
  );
  return res.status(200).json(rows);
  }
} catch (e) {
    console.error('[GET /api/payments]', e);
    return res.status(200).json([]);
  }
});
// Debug endpoint to read raw IPN events, filterable by ?ref= (matches m_payment_id or pf_payment_id)
app.get('/api/ipn-events', async (req, res) => {
  try {
    if (!pool) return res.status(200).json([]);
    const ref = (req.query.ref || '').toString().trim();
    if (ref) {
      const { rows } = await pool.query(
        `SELECT id, pf_payment_id, created_at, raw
         FROM ipn_events
         WHERE (raw->>'m_payment_id' = $1 OR pf_payment_id = $1)
         ORDER BY created_at DESC
         LIMIT 50`,
        [ref]
      );
      return res.status(200).json(rows);
    } else {
      const { rows } = await pool.query(
        `SELECT id, pf_payment_id, created_at, raw
         FROM ipn_events
         ORDER BY created_at DESC
         LIMIT 50`
      );
      return res.status(200).json(rows);
    }
  } catch (e) {
    console.error('[GET /api/ipn-events]', e);
    return res.status(200).json([]);
  }
});

// Get a single payment by ID (and recent related IPN events)
app.get('/api/payments/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1 LIMIT 1', [id]);
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'not found' });

    let ipn = [];
    try {
      const r2 = await pool.query(
        "SELECT id, pf_payment_id, created_at, raw FROM ipn_events WHERE (raw->>'m_payment_id') = $1 OR (raw->>'pf_payment_id') = $2 ORDER BY id DESC LIMIT 20",
        [String(payment.merchant_reference || ''), String(payment.pf_payment_id || '')]
      );
      ipn = r2.rows || [];
    } catch {}

    return res.json({ payment, ipn });
  } catch (err) {
    console.error('[GET /api/payments/:id] error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// --- PayFast signature helpers ---
function phpUrlEncode(val) {
  // PHP rawurlencode compatibility (spaces => %20, also encode ! * ( ) ~)
  const s = String(val ?? "");
  return encodeURIComponent(s)
    // DO NOT convert %20 to +; PayFast expects rawurlencode semantics.
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}
// Note: Uses PHP rawurlencode semantics (spaces encoded as %20, not +)
function signatureBase(obj, passphrase) {
  // Remove empty values and sort keys ascending
  const entries = Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let base = entries.map(([k, v]) => `${k}=${phpUrlEncode(v)}`).join("&");
  if (passphrase) base += `&passphrase=${phpUrlEncode(passphrase)}`;
  return base;
}
function md5hex(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// Backward compatibility for existing sign/toSignatureString usages
const toSignatureString = (obj) => signatureBase(obj, "");
const sign = (params) => {
  const passphrase = (process.env.PAYFAST_PASSPHRASE || "").trim();
  const base = signatureBase(params, passphrase);
  const sig = md5hex(base);
  console.log("[PayFast][Sign] Base:", base, " Sig:", sig);
  return sig;
};

// Decide which passphrase to use based on merchant_id + env.
// PayFast test merchant (10000100) must use NO passphrase.
function derivePayfastPassphrase(merchantId) {
  const id = String(merchantId || '').trim();
  if (id === '10000100') return ''; // force empty on sandbox test account
  return String(process.env.PAYFAST_PASSPHRASE || '').trim();
}

// Server-to-server IPN validation with PayFast (sandbox/live)
async function validateWithPayFast(params) {
  try {
    const mode = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
    const endpoint = mode === 'live'
      ? 'https://www.payfast.co.za/eng/query/validate'
      : 'https://sandbox.payfast.co.za/eng/query/validate';

    // Exclude signature from the postback per PayFast spec
    const { signature: _omit, ...withoutSig } = params || {};
    // Build form body using PHP-style encoding, *without* passphrase and *without* signature
    const body = signatureBase(withoutSig, '');

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = (await r.text()).trim();
    const ok = r.ok && text.toUpperCase().includes('VALID');
    if (!ok) console.warn('[PayFast][Validate] Response not VALID:', r.status, text);
    return ok;
  } catch (e) {
    console.error('[PayFast][Validate] Error', e);
    return false;
  }
}
async function ensurePaymentMetaCols(client) {
  // Safe to call repeatedly
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS note text`);
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS tags text[]`);
}
const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || 'dev-secret-do-not-use-in-prod';
function signToken(payload) {
  return jwt.sign(payload, AUTH_JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, AUTH_JWT_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const t = req.cookies?.auth || '';
  const data = verifyToken(t);
  if (!data) return res.status(401).json({ error: 'unauthorized' });
  req.user = data; next();
}
function requireAdmin(req, res, next) {
  if (!req.user || String(req.user.role) !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

app.post('/api/auth/bootstrap', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'forbidden' });
    if (!pool) return res.status(500).json({ error: 'no db' });
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (rows.length) return res.json({ ok: true, created: false });
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3)', [email, hash, 'admin']);
    return res.json({ ok: true, created: true });
  } catch (e) {
    console.error('[auth/bootstrap]', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'no db' });
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    const { rows } = await pool.query('SELECT id, email, password_hash, role FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'invalid credentials' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken({ id: u.id, email: u.email, role: u.role });
    res.cookie('auth', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.COOKIE_SECURE || process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 3600 * 1000,
    });
    // Ensure credentials header on actual response as well
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.json({ ok: true, user: { id: u.id, email: u.email, role: u.role } });
  } catch (e) {
    console.error('[auth/login]', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const data = verifyToken(req.cookies?.auth || '');
  if (!data) return res.status(401).json({ error: 'unauthorized' });
  return res.json({ ok: true, user: { id: data.id, email: data.email, role: data.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth', { httpOnly: true, sameSite: 'lax', secure: !!process.env.COOKIE_SECURE || process.env.NODE_ENV === 'production' });
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  return res.json({ ok: true });
});

app.post("/api/payfast/initiate", async (req, res) => {
  const mode = (process.env.PAYFAST_MODE || "sandbox").toLowerCase();
  const gateway = mode === "live"
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process";

  const merchant_id = process.env.PAYFAST_MERCHANT_ID;
  const merchant_key = process.env.PAYFAST_MERCHANT_KEY;
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

  const amount = (Number(req.body.amount || 50)).toFixed(2);
  // Generate a strict merchant reference (we'll validate amount by this later)
  const merchant_reference = `chur_${Date.now()}_${Math.random().toString(16).slice(2,8)}`;

  const pfParams = {
    merchant_id: String(merchant_id || "").trim(),
    merchant_key: String(merchant_key || "").trim(),
    amount: String(amount).trim(),
    item_name: String("Churpay Top Up").trim(),
    return_url: String(`${FRONTEND_URL}/payfast/return`).trim(),
    cancel_url: String(`${FRONTEND_URL}/payfast/cancel`).trim(),
    notify_url: String(`${BACKEND_URL}/api/payfast/ipn`).trim(),
    // merchant reference we control; PayFast sends it back as m_payment_id in IPN
    m_payment_id: merchant_reference,
  };

  // Best-effort: store the intent so we can strictly validate amount later
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO payments (pf_payment_id, amount, status, merchant_reference, payer_email, payer_name)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [null, Number(amount), 'INITIATED', merchant_reference, null, null]
      );
    } catch (e) {
      console.warn('[PayFast][Init] intent insert failed (non-fatal)', e?.message || e);
    }
  }

  // Sign and redirect (with optional debug to compare passphrase modes)
  const passphraseUsed = derivePayfastPassphrase(pfParams.merchant_id);

  // Single source of truth: compute base/signature with the selected passphrase
  const baseSelected = signatureBase(pfParams, passphraseUsed);
  const sigSelected = md5hex(baseSelected);
  const redirectUrl = `${gateway}?${toSignatureString(pfParams)}&signature=${sigSelected}`;

  // Also compute alternates for logging/diagnostics
  const baseWith = signatureBase(pfParams, (process.env.PAYFAST_PASSPHRASE || '').trim());
  const sigWith = md5hex(baseWith);
  const baseWithout = signatureBase(pfParams, '');
  const sigWithout = md5hex(baseWithout);

  console.log("[PayFast][Init] passphraseUsed=%s", passphraseUsed ? "(set)" : "(empty)");
  console.log("[PayFast][Init][baseSelected]", baseSelected);
  console.log("[PayFast][Init][sigSelected]", sigSelected);
  console.log("[PayFast][Init][with-pass]  base:", baseWith,  " sig:", sigWith);
  console.log("[PayFast][Init][no-pass]   base:", baseWithout," sig:", sigWithout);
  console.log("[PayFast][Init Params]", pfParams);
  console.log("[PayFast][Init RedirectURL]", redirectUrl);
  console.log("[PayFast] mode=%s merchant_id=%s gateway=%s amount=%s", mode, merchant_id, gateway, amount);

  return res.json({
    redirect: redirectUrl,
    merchant_reference
  });
});

// GET /api/payfast/initiate-form
// Usage: /api/payfast/initiate-form?amount=10.00
// Renders a tiny auto-submitting HTML form that POSTs to PayFast (recommended path)
app.get('/api/payfast/initiate-form', async (req, res) => {
  try {
    const mode = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
    const gateway = mode === 'live'
      ? 'https://www.payfast.co.za/eng/process'
      : 'https://sandbox.payfast.co.za/eng/process';

    const merchant_id = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    const merchant_key = String(process.env.PAYFAST_MERCHANT_KEY || '').trim();

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

    // amount can come from query (?amount=10.00), default to 50
    const amount = (Number(req.query.amount || 50)).toFixed(2);

    // Generate our strict merchant reference
    const merchant_reference = `chur_${Date.now()}_${Math.random().toString(16).slice(2,8)}`;

    const pfParams = {
      merchant_id,
      merchant_key,
      amount,
      item_name: 'Churpay Top Up',
      return_url: `${FRONTEND_URL}/payfast/return`,
      cancel_url: `${FRONTEND_URL}/payfast/cancel`,
      notify_url: `${BACKEND_URL}/api/payfast/ipn`,
      m_payment_id: merchant_reference,
    };

    // Persist INITIATED intent for strict amount match (best-effort)
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO payments (pf_payment_id, amount, status, merchant_reference, payer_email, payer_name)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [null, Number(amount), 'INITIATED', merchant_reference, null, null]
        );
      } catch (e) {
        console.warn('[PayFast][Init-Form] intent insert failed (non-fatal)', e?.message || e);
      }
    }

    // Sign with passphrase selected by derivePayfastPassphrase (merchant_id aware)
    const passphrase = derivePayfastPassphrase(pfParams.merchant_id);
    const base = signatureBase(pfParams, passphrase);
    const signature = md5hex(base);

    // Debug: show which mode we're using
    console.log('[PayFast][initiate-form] passphraseUsed=%s signature=%s', passphrase ? '(set)' : '(empty)', signature);

    // Build a minimal HTML form that auto-submits
    const inputs = Object.entries({ ...pfParams, signature })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v)}">`)
      .join('');

    const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Redirecting to PayFast…</title></head>
  <body>
    <form id="pf" method="post" action="${gateway}">
      ${inputs}
      <noscript><button type="submit">Continue to PayFast</button></noscript>
    </form>
    <script>document.getElementById('pf').submit();</script>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[PayFast][initiate-form] error', e);
    return res.status(500).send('Error');
  }
});

// GET /api/payfast/signature-preview?amount=10.00
// Returns the params, base string, and signature used (passphrase-aware) for quick debugging.
app.get('/api/payfast/signature-preview', async (req, res) => {
  try {
    const mode = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
    const merchant_id = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    const merchant_key = String(process.env.PAYFAST_MERCHANT_KEY || '').trim();
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
    const amount = (Number(req.query.amount || 50)).toFixed(2);
    const merchant_reference = `chur_${Date.now()}_${Math.random().toString(16).slice(2,8)}`;

    const pfParams = {
      merchant_id,
      merchant_key,
      amount,
      item_name: 'Churpay Top Up',
      return_url: `${FRONTEND_URL}/payfast/return`,
      cancel_url: `${FRONTEND_URL}/payfast/cancel`,
      notify_url: `${BACKEND_URL}/api/payfast/ipn`,
      m_payment_id: merchant_reference,
    };

    const passphraseUsed = derivePayfastPassphrase(merchant_id);
    const base = signatureBase(pfParams, passphraseUsed);
    const signature = md5hex(base);

    return res.json({
      mode,
      merchant_id,
      passphraseUsed: passphraseUsed ? '(set)' : '(empty)',
      params: pfParams,
      base,
      signature
    });
  } catch (e) {
    console.error('[PayFast][signature-preview] error', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/admin/test-email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = (req.body && req.body.to) || TEST_RECEIPT_TO || '';
    if (!to) return res.status(400).json({ error: 'missing to' });
    const out = await sendReceiptEmail({
      to,
      amount: 10,
      reference: `TEST_${Date.now()}`,
      status: 'TEST',
    });
    if (!out.ok && !out.skipped) {
      return res.status(500).json({ error: out.error || 'send failed' });
    }
    return res.json({ ok: true, to, skipped: !!out.skipped });
  } catch {
    return res.status(500).json({ error: 'internal' });
  }
});

app.post("/api/payfast/ipn", async (req, res) => {
  console.log('[PayFast][IPN] hit', new Date().toISOString());
  try {
    const configuredMerchantId = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    // Extract signature and params
    const { signature: receivedSig, ...params } = req.body || {};
    const passphrase = process.env.PAYFAST_PASSPHRASE || "";

    // 1) Basic signature verification
    const base = signatureBase(params, passphrase);
    const computed = md5hex(base);
    let verified = !!(receivedSig && receivedSig.toLowerCase() === computed.toLowerCase());
    if (!verified) console.warn("[PayFast][IPN] Signature mismatch", { receivedSig, computed });

    // 2) Merchant ID must match
    if (verified) {
      const ipnMerchant = String(params.merchant_id || '').trim();
      if (!ipnMerchant || ipnMerchant !== configuredMerchantId) {
        console.warn('[PayFast][IPN] Merchant ID mismatch', { ipnMerchant, configuredMerchantId });
        verified = false;
      }
    }

    // 3) Server-to-server validation with PayFast
    if (verified) {
      const valid = await validateWithPayFast(req.body || {});
      if (!valid) {
        console.warn('[PayFast][IPN] Remote validate failed');
        verified = false;
      }
    }

    // 4) Strict amount match vs our stored intent by merchant reference
    let amountOk = false;
    let expectedAmount = null;
    const ipnAmount = Number(params.amount_gross || params.amount || 0);
    const ref = params.m_payment_id || params.merchant_reference || null;

    if (pool && ref) {
      try {
        const { rows } = await pool.query('SELECT amount FROM payments WHERE merchant_reference = $1 ORDER BY created_at DESC LIMIT 1', [ref]);
        if (rows.length) {
          expectedAmount = Number(rows[0].amount);
          // strictly equal to 2dp
          amountOk = (Number(ipnAmount.toFixed(2)) === Number(expectedAmount.toFixed(2)));
          if (!amountOk) console.warn('[PayFast][IPN] Amount mismatch', { ref, expectedAmount, ipnAmount });
        }
      } catch (e) {
        console.error('[IPN] amount lookup failed', e);
      }
    }

    const finalOk = verified && amountOk;

    // Save raw IPN regardless
    if (pool) {
      try {
        const pfId = params.pf_payment_id || null;
        await pool.query(
          `INSERT INTO ipn_events (pf_payment_id, raw) VALUES ($1, $2)`,
          [pfId, JSON.stringify(req.body || {})]
        );
      } catch (e) {
        console.error("[IPN] DB ipn_events insert error", e);
      }
    }

    // Upsert payment with final status if checks passed (strict), else mark INVALID
    if (pool) {
      try {
        const pfId = params.pf_payment_id || null;
        const status = finalOk ? String(params.payment_status || 'UNKNOWN') : 'INVALID';
        const merchant_reference = ref;
        const payer_email = params.email_address || params.payer_email || null;
        const payer_name = params.name_first || params.payer_name || null;
        const amt = Number(ipnAmount || 0);
        await pool.query(
          `INSERT INTO payments (pf_payment_id, amount, status, merchant_reference, payer_email, payer_name)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (pf_payment_id) DO UPDATE
           SET amount = EXCLUDED.amount,
               status = EXCLUDED.status,
               merchant_reference = EXCLUDED.merchant_reference,
               payer_email = EXCLUDED.payer_email,
               payer_name = EXCLUDED.payer_name`,
          [pfId, isFinite(amt) ? amt : 0, status, merchant_reference, payer_email, payer_name]
        );
      } catch (e) {
        console.error("[IPN] payments upsert error", e);
      }
    }

    // Send receipt for successful payments (COMPLETE)
    try {
      const statusUpper = String(params.payment_status || '').toUpperCase();
      if (finalOk && statusUpper === 'COMPLETE' && (params.email_address || params.payer_email)) {
        await sendReceiptEmail({
          to: params.email_address || params.payer_email,
          amount: ipnAmount,
          reference: ref,
          status: 'COMPLETE',
          payerName: params.name_first || ''
        });
      }
    } catch (e) {
      console.warn('[Mail] IPN receipt failed', e?.message || e);
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("[PayFast][IPN] Error:", e);
    res.status(200).send("OK"); // PayFast expects 200 regardless
  }
});

// Admin-only: revalidate a payment using the latest stored IPN event for a given reference
app.post('/api/payfast/revalidate', requireAuth, async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'no db' });
    const ref = (req.body?.ref || '').toString().trim();
    if (!ref) return res.status(400).json({ error: 'missing ref' });

    // Load the most recent IPN payload for this reference (m_payment_id)
    const { rows } = await pool.query(
      `SELECT id, pf_payment_id, raw, created_at
       FROM ipn_events
       WHERE (raw->>'m_payment_id' = $1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [ref]
    );
    if (!rows.length) return res.status(404).json({ error: 'no ipn for ref' });

    const ipn = rows[0];
    const raw = ipn.raw || {};

    // 1) Recompute signature with current passphrase
    const receivedSig = String(raw.signature || '').toLowerCase();
    const passphrase = process.env.PAYFAST_PASSPHRASE || '';
    const { signature: _omit, ...paramsForSig } = raw;
    const base = signatureBase(paramsForSig, passphrase);
    const computed = md5hex(base);
    const sigOk = !!(receivedSig && receivedSig === computed.toLowerCase());

    // 2) Merchant match
    const configuredMerchantId = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    const ipnMerchant = String(raw.merchant_id || '').trim();
    const merchantOk = ipnMerchant && ipnMerchant === configuredMerchantId;

    // 3) Server-to-server validate (postback to PayFast)
    const remoteOk = await validateWithPayFast(raw);

    // 4) Amount strict match to our stored intent
    let amountOk = false;
    let expectedAmount = null;
    const ipnAmount = Number(raw.amount_gross || raw.amount || 0);
    try {
      const q = await pool.query(
        'SELECT amount FROM payments WHERE merchant_reference=$1 ORDER BY created_at DESC LIMIT 1',
        [ref]
      );
      if (q.rows.length) {
        expectedAmount = Number(q.rows[0].amount);
        amountOk = (Number(ipnAmount.toFixed(2)) === Number(expectedAmount.toFixed(2)));
      }
    } catch (e) {
      console.error('[revalidate] amount lookup failed', e);
    }

    const finalOk = sigOk && merchantOk && remoteOk && amountOk;

    // Upsert payment status based on revalidation result
    try {
      const pfId = raw.pf_payment_id || null;
      const status = finalOk ? String(raw.payment_status || 'UNKNOWN') : 'INVALID';
      const payer_email = raw.email_address || raw.payer_email || null;
      const payer_name = raw.name_first || raw.payer_name || null;
      const amt = Number(ipnAmount || 0);
      await pool.query(
        `INSERT INTO payments (pf_payment_id, amount, status, merchant_reference, payer_email, payer_name)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (pf_payment_id) DO UPDATE
         SET amount = EXCLUDED.amount,
             status = EXCLUDED.status,
             merchant_reference = EXCLUDED.merchant_reference,
             payer_email = EXCLUDED.payer_email,
             payer_name = EXCLUDED.payer_name`,
        [pfId, isFinite(amt) ? amt : 0, status, ref, payer_email, payer_name]
      );
    } catch (e) {
      console.error('[revalidate] payments upsert error', e);
    }

    return res.json({ ok: finalOk, checks: { sigOk, merchantOk, remoteOk, amountOk, expectedAmount, ipnAmount } });
  } catch (e) {
    console.error('[revalidate] error', e);
    return res.status(500).json({ error: 'internal' });
  }
});

// ---------------- Admin payment actions (require admin) ----------------
app.post('/api/admin/payments/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'no db' });
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toUpperCase();
    const ALLOWED = new Set(['PAID','FAILED','PENDING','SUCCESS','COMPLETE','INVALID']);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    if (!ALLOWED.has(status)) return res.status(400).json({ error: 'bad status' });
    const q = await pool.query('UPDATE payments SET status=$1 WHERE id=$2 RETURNING id, status', [status, id]);
    if (!q.rowCount) return res.status(404).json({ error: 'not found' });
    // If marked as PAID/COMPLETE, try to send receipt using stored email
    if (status === 'PAID' || status === 'COMPLETE' || status === 'SUCCESS') {
      try {
        const info = await pool.query(
          'SELECT merchant_reference, amount, payer_email, payer_name FROM payments WHERE id=$1',
          [id]
        );
        if (info.rows.length) {
          const p = info.rows[0];
          await sendReceiptEmail({
            to: p.payer_email,
            amount: p.amount,
            reference: p.merchant_reference,
            status: status,
            payerName: p.payer_name || ''
          });
        }
      } catch (e) {
        console.warn('[Mail] admin send receipt failed', e?.message || e);
      }
    }
    return res.json({ ok: true, payment: q.rows[0] });
  } catch (e) {
    console.error('[admin/status]', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/admin/payments/:id/note', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'no db' });
    const id = Number(req.params.id);
    const note = String(req.body?.note || '').trim();
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    const q = await pool.query('UPDATE payments SET note=$1 WHERE id=$2 RETURNING id, note', [note || null, id]);
    if (!q.rowCount) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true, payment: q.rows[0] });
  } catch (e) {
    console.error('[admin/note]', e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/admin/payments/:id/tag', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: 'no db' });
    const id = Number(req.params.id);
    const tag = String(req.body?.tag || '').trim();
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    if (!tag) return res.status(400).json({ error: 'missing tag' });
    const q = await pool.query(
      `UPDATE payments
         SET tags = (
           CASE WHEN tags IS NULL THEN ARRAY[$1]::text[]
                WHEN NOT ($1 = ANY(tags)) THEN array_append(tags, $1)
                ELSE tags
           END
         )
       WHERE id = $2
       RETURNING id, tags`,
      [tag, id]
    );
    if (!q.rowCount) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true, payment: q.rows[0] });
  } catch (e) {
    console.error('[admin/tag]', e);
    return res.status(500).json({ error: 'internal' });
  }
});
// ---------------- end admin payment actions ----------------



const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Backend on", port));
// Log build info once at startup for visibility in Render logs
console.log("[Version]", JSON.stringify(buildInfo));
// deploy-bump 2025-08-11T15:11:41Z
