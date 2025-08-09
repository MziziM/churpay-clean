import { useEffect, useMemo, useState, useRef } from "react";
import './App.css';

function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type} show`}>
          {t.title && <div className="title">{t.title}</div>}
          <div>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const apiBase = import.meta.env.VITE_API_URL?.trim();
  const [health, setHealth] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [amount, setAmount] = useState("50.00");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const ZAR = useMemo(() => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }), []);

  const pushToast = (type, msg, title) => {
    const id = nextId.current++;
    setToasts(ts => [...ts, { id, type, msg, title }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3500);
  };

  const loadHealth = async () => {
    try {
      const r = await fetch(`${apiBase}/api/health`);
      const j = await r.json();
      setHealth(j);
      if (j?.ok) pushToast("ok", "API is reachable.", "Health: OK");
      else pushToast("err", "Backend health returned ERROR.", "Health");
    } catch (e) {
      setHealth({ ok: false, error: String(e) });
      pushToast("err", "Failed to reach backend health.", "Network");
    }
  };

  const loadPayments = async () => {
    try {
      setLoadingPayments(true);
      const r = await fetch(`${apiBase}/api/payments`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setPayments(Array.isArray(j) ? j : (j?.rows || []));
      pushToast("ok", "Payments refreshed.");
    } catch (e) {
      pushToast("err", "Could not load payments.");
    } finally {
      setLoadingPayments(false);
    }
  };

  const startPayment = async (amt) => {
    const value = String(amt ?? amount).replace(",", ".");
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num) || num <= 0) {
      pushToast("err", "Enter a valid ZAR amount like 50.00", "Invalid amount");
      return;
    }
    try {
      setBusy(true);
      const r = await fetch(`${apiBase}/api/payfast/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: num.toFixed(2) }),
      });
      const j = await r.json();
      if (j.redirect) {
        pushToast("ok", `Redirecting to PayFast for ${ZAR.format(num)}…`);
        window.location.href = j.redirect;
      } else {
        pushToast("err", "Failed to start payment.");
      }
    } catch {
      pushToast("err", "Network error starting payment.");
    } finally {
      setBusy(false);
    }
  };

  // Return/cancel routes
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  if (path.startsWith("/payfast/return"))
    return (
      <div className="container">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Payment successful 🎉</h1>
          <p>Thanks! Your payment was processed.</p>
          <a href="/" className="btn">Back to Home</a>
        </div>
        <Toasts toasts={toasts} />
      </div>
    );
  if (path.startsWith("/payfast/cancel"))
    return (
      <div className="container">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Payment cancelled</h1>
          <p>No charges were made. You can try again anytime.</p>
          <a href="/" className="btn">Back to Home</a>
        </div>
        <Toasts toasts={toasts} />
      </div>
    );

  useEffect(() => { loadHealth(); loadPayments(); }, [apiBase]);

  // KPIs
  const totalCount = payments.length;
  const totalZar = payments.reduce((acc, p) => acc + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0), 0);
  const lastCreated = payments[0]?.created_at ? new Date(payments[0].created_at).toLocaleString() : "—";

  return (
    <div className="container">
      {/* header + hero unchanged */}
      <div className="header">
        <div className="brand">
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#60a5fa,#22c55e)" }} />
          <div>Churpay</div>
        </div>
        <span className="badge">Sandbox</span>
      </div>

      <div className="hero">
        <div style={{ fontSize: 18, color: "var(--text)" }}>Seamless payments made simple.</div>
        <div className="points">
          <div className="point">Fast checkout via PayFast</div>
          <div className="point">Secure IPN updates</div>
          <div className="point">Built for churches & NPOs</div>
        </div>
      </div>

      {/* status card */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="kv"><span>API base:</span> <strong>{apiBase}</strong></div>
          <div className={`status ${health && health.ok ? "ok" : "err"}`}>
            Health: {health ? (health.ok ? "OK" : "ERROR") : "…"}
          </div>
        </div>
        {!health?.ok && health && (
          <>
            <hr className="hr" />
            <pre className="empty" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(health, null, 2)}</pre>
          </>
        )}
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi"><div className="label">Total processed</div><div className="value">{ZAR.format(totalZar)}</div></div>
        <div className="kpi"><div className="label">Payments</div><div className="value">{totalCount}</div></div>
        <div className="kpi"><div className="label">Last payment</div><div className="value">{lastCreated}</div></div>
      </div>

      {/* payment form */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <label>Amount (ZAR):</label>
          <input className="input" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          <button className="btn" onClick={() => startPayment()} disabled={busy}>{busy ? "Starting…" : "Pay with PayFast (Sandbox)"}</button>
          <button className="btn" onClick={() => startPayment(10)} disabled={busy} title="Quick R10 demo">Demo R10</button>
        </div>
      </div>

      {/* payments table */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Recent Payments</h2>
          <button className="btn" onClick={loadPayments} disabled={loadingPayments}>{loadingPayments ? "Loading…" : "Refresh"}</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>ID</th><th>PF Payment ID</th><th>Amount</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={5} className="empty">{loadingPayments ? "Loading…" : "No payments yet"}</td></tr>
              ) : payments.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.pf_payment_id || "-"}</td>
                  <td>{typeof p.amount === "number" ? ZAR.format(p.amount) : (p.amount ?? "-")}</td>
                  <td>{p.status || "-"}</td>
                  <td>{p.created_at ? new Date(p.created_at).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="footer">Data updates after PayFast IPN; refresh after completing a payment.</div>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}