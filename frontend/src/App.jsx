import { useEffect, useState } from "react";

export default function App() {
  const apiBase = import.meta.env.VITE_API_URL?.trim();
  const [health, setHealth] = useState(null);
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState("50.00");

  const load = async () => {
    try {
      const r = await fetch(`${apiBase}/api/health`);
      setHealth(await r.json());
    } catch (e) {
      setHealth({ ok: false, error: String(e) });
    }
  };

  const pay = async () => {
    try {
      const r = await fetch(`${apiBase}/api/payfast/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount).toFixed(2) }),
      });
      const j = await r.json();
      if (j.redirect) window.location.href = j.redirect;
    } catch (e) {
      alert("Failed to start payment: " + e);
    }
  };

  // Simple return/cancel pages (no router needed)
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path.startsWith("/payfast/return"))
    return (
      <div style={{ padding: 24, fontFamily: "Inter, system-ui, Arial" }}>
        <h1>Payment successful 🎉</h1>
        <a href="/" style={{ color: "#3b82f6" }}>Back</a>
      </div>
    );
  if (path.startsWith("/payfast/cancel"))
    return (
      <div style={{ padding: 24, fontFamily: "Inter, system-ui, Arial" }}>
        <h1>Payment cancelled</h1>
        <a href="/" style={{ color: "#3b82f6" }}>Back</a>
      </div>
    );

  useEffect(() => { load(); }, [apiBase]);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, Arial" }}>
      <h1>Churpay</h1>
      <p>Seamless payments made simple.</p>
      <div>API base: <strong>{apiBase}</strong></div>
      <div>Health: {health ? (health.ok ? "OK" : "ERROR") : "…"}</div>

      <hr />
      <label>Amount (ZAR): </label>
      <input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} />
      <button onClick={pay} style={{ marginLeft: 8 }}>Pay with PayFast (Sandbox)</button>

      <hr />
      <h3>Recent Payments</h3>
      <div style={{color:"#6b7280"}}>(optional) hook this to /api/payments when DB is ready)</div>
    </div>
  );
}
