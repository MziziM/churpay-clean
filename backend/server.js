import express from "express";
import cors from "cors";
import morgan from "morgan";
import crypto from "crypto";
import qs from "qs";
import pkg from "pg";
const { Pool } = pkg;



const app = express();
app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: false })); // for IPN (form-encoded)
app.use(express.json());

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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          pf_payment_id TEXT,
          amount NUMERIC(12,2),
          status TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log("[DB] payments table ready");
    } catch (err) {
      console.error("[DB] init error", err);
    }
  })();
} else {
  console.warn("[DB] No DATABASE_URL configured — /api/payments will return []");
}

// CORS
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: CORS_ORIGINS.length ? CORS_ORIGINS : true }));

app.get("/", (_req, res) => res.json({ message: "Churpay Backend is running" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "backend" }));
app.get("/api/payments", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(200).json([]);
    }
    const { rows } = await pool.query(
      `SELECT id, pf_payment_id, amount::float8 AS amount, status, created_at
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

// PayFast helpers
const toSignatureString = (obj) => {
  // PHP urlencode compatibility (spaces => '+', encode ! * ( ) ~)
  const phpEncode = (val) => {
    const s = String(val ?? "");
    return encodeURIComponent(s)
      .replace(/%20/g, "+")
      .replace(/!/g, "%21")
      .replace(/\*/g, "%2A")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/~/g, "%7E");
  };

  // Remove empty values and sort keys ascending
  const entries = Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && v !== "");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  // Build query string in insertion order using PHP-style encoding
  return entries.map(([k, v]) => `${k}=${phpEncode(v)}`).join("&");
};

const sign = (params) => {
  const passphrase = process.env.PAYFAST_PASSPHRASE || "";
  let base = toSignatureString(params);
  if (passphrase) {
    const phpEncode = (s) => encodeURIComponent(s)
      .replace(/%20/g, "+")
      .replace(/!/g, "%21")
      .replace(/\*/g, "%2A")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/~/g, "%7E");
    base += `&passphrase=${phpEncode(passphrase)}`;
  }
  const sig = crypto.createHash("md5").update(base).digest("hex");
  console.log("[PayFast][Sign] Base:", base, " Sig:", sig);
  return sig;
};

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
    const { signature: receivedSig, ...params } = req.body || {};
    const computed = sign(params);
    if (!receivedSig || receivedSig.toLowerCase() !== computed.toLowerCase()) {
      console.warn("[PayFast][IPN] Signature mismatch", { receivedSig, computed });
    } else {
      console.log("[PayFast][IPN] Signature verified");
      // Attempt to persist payment to DB (best-effort)
      if (pool) {
        try {
          const pfId = params.pf_payment_id || null;
          const status = String(params.payment_status || "UNKNOWN");
          const amt = Number(params.amount_gross || params.amount || 0);
          await pool.query(
            `INSERT INTO payments (pf_payment_id, amount, status) VALUES ($1, $2, $3)`,
            [pfId, isFinite(amt) ? amt : 0, status]
          );
        } catch (e) {
          console.error("[IPN] DB insert error", e);
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
