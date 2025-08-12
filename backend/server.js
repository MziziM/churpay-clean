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
// near the top, after imports
import { execSync } from 'child_process';
import os from 'os';
import appPkg from './package.json' assert { type: 'json' };



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
// -------------------- Mailer (optional via env) --------------------
const MAIL_HOST = process.env.MAIL_HOST || '';
const MAIL_PORT = Number(process.env.MAIL_PORT || 0);
const MAIL_USER = process.env.MAIL_USER || '';
const MAIL_PASS = process.env.MAIL_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@churpay.com';

let mailer = null;
if (MAIL_HOST && MAIL_PORT && MAIL_USER && MAIL_PASS) {
  mailer = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: MAIL_PORT === 465, // true for 465, false for others
    auth: { user: MAIL_USER, pass: MAIL_PASS },
  });
  mailer.verify().then(() => {
    console.log('[Mail] transporter ready');
  }).catch(err => {
    console.warn('[Mail] verify failed:', err?.message || err);
  });
} else {
  console.warn('[Mail] Not configured (set MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, FROM_EMAIL)');
}

async function sendReceiptEmail({ to, amount, reference, status, payerName }) {
  if (!mailer || !to) return false;
  try {
    const subject = `ChurPay receipt — ${status}`;
    const prettyAmt = isFinite(Number(amount)) ? Number(amount).toFixed(2) : String(amount);
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif">
        <h2 style="margin:0 0 8px 0;">ChurPay Receipt</h2>
        <p style="margin:0 0 12px 0; color:#444;">${payerName ? `Hi ${payerName},` : 'Hello,'}</p>
        <p style="margin:0 0 12px 0;">Thank you. Your payment status is <strong>${status}</strong>.</p>
        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;">
          <tr><td style="border:1px solid #eee;">Reference</td><td style="border:1px solid #eee;"><code>${reference}</code></td></tr>
          <tr><td style="border:1px solid #eee;">Amount</td><td style="border:1px solid #eee;">R ${prettyAmt}</td></tr>
          <tr><td style="border:1px solid #eee;">Status</td><td style="border:1px solid #eee;">${status}</td></tr>
        </table>
        <p style="margin:12px 0 0 0; color:#777;">If you have any questions, reply to this email.</p>
      </div>`;
    const text = `ChurPay receipt\n\nReference: ${reference}\nAmount: R ${prettyAmt}\nStatus: ${status}\n`;
    await mailer.sendMail({
      from: FROM_EMAIL,
      to,
      subject,
      text,
      html,
    });
    console.log('[Mail] receipt sent to', to);
    return true;
  } catch (e) {
    console.warn('[Mail] send failed:', e?.message || e);
    return false;
  }
}
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

app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: false })); // for IPN (form-encoded)
app.use(express.json());
app.use(cookieParser());
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


// --- PayFast signature helpers ---
function phpUrlEncode(val) {
  // PHP urlencode compatibility (spaces => '+', encode ! * ( ) ~)
  const s = String(val ?? "");
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}
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
  const passphrase = process.env.PAYFAST_PASSPHRASE || "";
  const base = signatureBase(params, passphrase);
  const sig = md5hex(base);
  console.log("[PayFast][Sign] Base:", base, " Sig:", sig);
  return sig;
};

// Server-to-server IPN validation with PayFast (sandbox/live)
async function validateWithPayFast(params) {
  try {
    const mode = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
    const endpoint = mode === 'live'
      ? 'https://www.payfast.co.za/eng/query/validate'
      : 'https://sandbox.payfast.co.za/eng/query/validate';

    // Build form body as application/x-www-form-urlencoded
    const body = signatureBase(params, '').toString(); // same encoding as sent to us (excluding passphrase)

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
  const passphraseEnv = process.env.PAYFAST_PASSPHRASE || "";
  const signBoth = String(process.env.PAYFAST_SIGN_BOTH || '').toLowerCase() === 'true';

  const baseWith = signatureBase(pfParams, passphraseEnv);
  const sigWith = md5hex(baseWith);
  const urlWith = `${gateway}?${toSignatureString(pfParams)}&signature=${sigWith}`;

  const baseWithout = signatureBase(pfParams, '');
  const sigWithout = md5hex(baseWithout);
  const urlWithout = `${gateway}?${toSignatureString(pfParams)}&signature=${sigWithout}`;

  // Prefer the signing mode that matches your PayFast dashboard settings.
  // Default behavior keeps using the env passphrase (same as before)
  const redirectUrl = urlWith;

  console.log("[PayFast][Sign][with-pass] Base:", baseWith, " Sig:", sigWith);
  console.log("[PayFast][Sign][no-pass]  Base:", baseWithout, " Sig:", sigWithout);

  if (signBoth) {
    console.log("[PayFast][Init RedirectURL][with-pass]", urlWith);
    console.log("[PayFast][Init RedirectURL][no-pass] ", urlWithout);
    return res.json({
      redirect: urlWith,
      merchant_reference,
      debug: {
        with_passphrase: { base: baseWith, signature: sigWith, url: urlWith },
        without_passphrase: { base: baseWithout, signature: sigWithout, url: urlWithout }
      }
    });
  }

  const redirectQuery = `${toSignatureString(pfParams)}&signature=${sigWith}`;
  // keep prior logs and response shape
  const _unused = redirectQuery; // no-op to retain variable referenced in earlier logs if any

  console.log("[PayFast][Init Params]", pfParams);
  console.log("[PayFast][Init RedirectURL]", redirectUrl);
  console.log("[PayFast] mode=%s merchant_id=%s gateway=%s amount=%s", mode, merchant_id, gateway, amount);
  return res.json({ redirect: redirectUrl, merchant_reference });
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

// Allow one-off migrations via CLI flag
if (process.argv.includes('--migrate-only')) {
  if (!pool) {
    console.warn('[DB] No DATABASE_URL configured, nothing to migrate.');
    process.exit(0);
  }
  runMigrations().then(() => process.exit(0)).catch(() => process.exit(1));
}

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Backend on", port));
// deploy-bump 2025-08-11T15:11:41Z
