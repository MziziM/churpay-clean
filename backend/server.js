import express from "express";
import cors from "cors";
import morgan from "morgan";
import crypto from "crypto";
import qs from "qs";

const app = express();
app.use(morgan("tiny"));
app.use(express.urlencoded({ extended: false })); // for IPN (form-encoded)
app.use(express.json());

// CORS
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: CORS_ORIGINS.length ? CORS_ORIGINS : true }));

app.get("/", (_req, res) => res.json({ message: "Churpay Backend is running" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "backend" }));
// List recent payments (temporary stub)
// Temporary stub: list payments (replace with DB query later)
app.get("/api/payments", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json([]);
});

// PayFast helpers
const toSignatureString = (obj) => {
  const clean = Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && v !== ""));
  const sorted = Object.keys(clean).sort().reduce((a, k) => (a[k] = clean[k], a), {});
  return qs.stringify(sorted, { encode: true }); // RFC3986
};
const sign = (params) => {
  const passphrase = process.env.PAYFAST_PASSPHRASE; // include only if set
  const base = toSignatureString(params) + (passphrase ? `&passphrase=${passphrase}` : "");
  console.log("[PayFast][Sign] Base string:", base);
  return crypto.createHash("md5").update(base).digest("hex");
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

  const amount = Number(req.body.amount || 50).toFixed(2);

  const pfParams = {
    merchant_id,
    merchant_key,
    amount,
    item_name: "Churpay Top Up",
    return_url: `${FRONTEND_URL}/payfast/return`,
    cancel_url: `${FRONTEND_URL}/payfast/cancel`,
    notify_url: `${BACKEND_URL}/api/payfast/ipn`,
  };

  const signature = sign(pfParams);
  const redirectUrl = `${gateway}?${qs.stringify({ ...pfParams, signature }, { encode: true })}`;
  console.log("[PayFast] mode=%s merchant_id=%s gateway=%s amount=%s", mode, merchant_id, gateway, amount);
  return res.json({ redirect: redirectUrl });
});

app.post("/api/payfast/ipn", (req, res) => {
  try {
    const { signature: receivedSig, ...params } = req.body || {};
    const computed = sign(params);
    if (!receivedSig || receivedSig.toLowerCase() !== computed.toLowerCase()) {
      console.warn("[PayFast][IPN] Signature mismatch", { receivedSig, computed });
    } else {
      console.log("[PayFast][IPN] Signature verified");
    }
    // TODO: insert into DB if you want persistence
    res.status(200).send("OK");
  } catch (e) {
    console.error("[PayFast][IPN] Error:", e);
    res.status(200).send("OK"); // PayFast expects 200 regardless
  }
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Backend on", port));