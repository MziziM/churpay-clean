import express from "express";
import morgan from "morgan";
import crypto from "crypto";
import qs from "qs";
import pkg from "pg";
const { Pool } = pkg;
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const app = express();

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

// other middleware and routes below...

app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: false })); // for IPN (form-encoded)
app.use(express.json());
app.use(cookieParser());

// --- Postgres (Render) optional setup ---
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("render.com") || DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : false,
  });
  (async () => {
    try {
      // Create payments table with all relevant columns
      await pool.query(`
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
      `);
      // Create ipn_events table for raw IPN logs
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ipn_events (
          id SERIAL PRIMARY KEY,
          pf_payment_id TEXT,
          raw JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'admin',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log("[DB] payments and ipn_events tables ready");
    } catch (err) {
      console.error("[DB] init error", err);
    }
  })();
} else {
  console.warn("[DB] No DATABASE_URL configured — /api/payments will return []");
}

app.get("/", (_req, res) => res.json({ message: "Churpay Backend is running" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "backend" }));
app.get("/api/payments", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(200).json([]);
    }
    const { rows } = await pool.query(
      `SELECT id, pf_payment_id, amount::float8 AS amount, status, merchant_reference, payer_email, payer_name, created_at
       FROM payments
       ORDER BY created_at DESC
       LIMIT 100`
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error("[GET /api/payments]", err);
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
  if (passphrase) base += `&passphrase=${passphrase}`;
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

app.post("/api/payfast/initiate", (req, res) => {
  const mode = (process.env.PAYFAST_MODE || "sandbox").toLowerCase();
  const gateway = mode === "live"
    ? "https://www.payfast.co.za/eng/process"
    : "https://sandbox.payfast.co.za/eng/process";

  const merchant_id = process.env.PAYFAST_MERCHANT_ID;
  const merchant_key = process.env.PAYFAST_MERCHANT_KEY;
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

  const amount = (Number(req.body.amount || 50)).toFixed(2);

  const pfParams = {
    merchant_id: String(merchant_id || "").trim(),
    merchant_key: String(merchant_key || "").trim(),
    amount: String(amount).trim(),
    item_name: String("Churpay Top Up").trim(),
    return_url: String(`${FRONTEND_URL}/payfast/return`).trim(),
    cancel_url: String(`${FRONTEND_URL}/payfast/cancel`).trim(),
    notify_url: String(`${BACKEND_URL}/api/payfast/ipn`).trim(),
  };

  // Debug logging for PayFast initiation
  console.log("[PayFast][Init Params]", pfParams);

  // Sign using alphabetically sorted, PHP-encoded values; passphrase is appended only to the base string (not sent as a field)
  const signature = sign(pfParams);
  const redirectQuery = `${toSignatureString(pfParams)}&signature=${signature}`;
  const redirectUrl = `${gateway}?${redirectQuery}`;

  console.log("[PayFast][Init RedirectQuery]", redirectQuery);
  console.log("[PayFast][Init RedirectURL]", redirectUrl);
  console.log("[PayFast] mode=%s merchant_id=%s gateway=%s amount=%s", mode, merchant_id, gateway, amount);
  return res.json({ redirect: redirectUrl });
});

app.post("/api/payfast/ipn", async (req, res) => {
  try {
    // Extract signature and params
    const { signature: receivedSig, ...params } = req.body || {};
    const passphrase = process.env.PAYFAST_PASSPHRASE || "";
    // Compute base string and signature
    const base = signatureBase(params, passphrase);
    const computed = md5hex(base);
    let verified = false;
    if (receivedSig && receivedSig.toLowerCase() === computed.toLowerCase()) {
      verified = true;
      console.log("[PayFast][IPN] Signature verified");
    } else {
      console.warn("[PayFast][IPN] Signature mismatch", { receivedSig, computed });
    }
    // Save raw IPN event to ipn_events (best-effort)
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
      // Upsert into payments if signature verified
      if (verified) {
        try {
          const pfId = params.pf_payment_id || null;
          const status = String(params.payment_status || "UNKNOWN");
          const amt = Number(params.amount_gross || params.amount || 0);
          const merchant_reference = params.merchant_reference || null;
          const payer_email = params.email_address || params.payer_email || null;
          const payer_name = params.name_first || params.payer_name || null;
          await pool.query(
            `INSERT INTO payments (pf_payment_id, amount, status, merchant_reference, payer_email, payer_name)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (pf_payment_id) DO UPDATE
             SET amount = EXCLUDED.amount,
                 status = EXCLUDED.status,
                 merchant_reference = EXCLUDED.merchant_reference,
                 payer_email = EXCLUDED.payer_email,
                 payer_name = EXCLUDED.payer_name
            `,
            [
              pfId,
              isFinite(amt) ? amt : 0,
              status,
              merchant_reference,
              payer_email,
              payer_name,
            ]
          );
        } catch (e) {
          console.error("[IPN] payments upsert error", e);
        }
      }
    }
    res.status(200).send("OK");
  } catch (e) {
    console.error("[PayFast][IPN] Error:", e);
    res.status(200).send("OK"); // PayFast expects 200 regardless
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Backend on", port));
// deploy-bump 2025-08-11T15:11:41Z
