import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";
import Deck from "./Deck.jsx";

// --- Toasts UI (aria-live for accessibility) ---
function Toasts({ toasts }) {
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type} show`}>
          {t.title && <div className="title">{t.title}</div>}
          <div>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

// --- Small util: safe JSON (helps when backend returns HTML errors) ---
async function safeJson(response) {
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Expected JSON but got ${ct || "unknown"}. Status ${response.status}. Body: ${text.slice(
        0,
        160
      )}…`
    );
  }
  return response.json();
}

function DeckKeyForm({ expectedKey, onUnlock }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) { setError("Enter your access key."); return; }
    if (expectedKey && trimmed !== expectedKey) { setError("Incorrect key."); return; }
    localStorage.setItem("churpay_deck_key", trimmed);
    setError("");
    onUnlock?.();
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <input className="input" placeholder="Enter access key" value={input} onChange={(e)=>setInput(e.target.value)} />
      <button className="btn" type="submit">Unlock</button>
      {error && <div className="alert err" style={{ marginLeft: 8 }}>{error}</div>}
    </form>
  );
}

export default function App() {
  // If not provided, default to same-origin
  const apiBase = (import.meta.env.VITE_API_URL || "").trim() || "";
  const APP_ENV = (import.meta.env.VITE_ENV || "").trim().toLowerCase(); // "production" hides Sandbox badge

  const [health, setHealth] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [amount, setAmount] = useState("50.00");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const [copied, setCopied] = useState({});
  const [lastRefreshAt, setLastRefreshAt] = useState(0); // timestamp of last successful refresh
  const [nowTick, setNowTick] = useState(Date.now());   // re-render every second for "X seconds ago"

  const ZAR = useMemo(
    () => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }),
    []
  );

  const pushToast = (type, msg, title) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, type, msg, title }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        pushToast("ok", `Copied: ${text}`);
        setCopied((c) => ({ ...c, [text]: true }));
        setTimeout(() => setCopied((c) => {
          const n = { ...c }; delete n[text]; return n;
        }), 1500);
      })
      .catch(() => pushToast("err", "Failed to copy"));
  };

  const loadHealth = async () => {
    try {
      const r = await fetch(`${apiBase}/api/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      setHealth(j);
      if (j?.ok) pushToast("ok", "API is reachable.", "Health: OK");
      else pushToast("err", "Backend health returned ERROR.", "Health");
    } catch (e) {
      setHealth({ ok: false, error: String(e?.message || e) });
      pushToast("err", "Failed to reach backend health.", "Network");
    }
  };

  const loadPayments = async () => {
    try {
      setLoadingPayments(true);
      const r = await fetch(`${apiBase}/api/payments`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      const rows = Array.isArray(j) ? j : j?.rows || [];
      // Sort newest first based on created_at
      rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setPayments(rows);
      setLastRefreshAt(Date.now());
      pushToast("ok", `Payments refreshed (${rows.length})`, "Success");
    } catch {
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
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      if (j.redirect) {
        pushToast("ok", `Redirecting to PayFast for ${ZAR.format(num)}…`);
        window.location.href = j.redirect;
      } else {
        pushToast("err", "Failed to start payment.");
      }
    } catch (e) {
      console.error("startPayment error", e);
      pushToast("err", "Network error starting payment.");
    } finally {
      setBusy(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadHealth();
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Tick every second to update "Last updated Xs ago"
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // KPIs
  const totalCount = payments.length;
  const totalZar = payments.reduce(
    (acc, p) => acc + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0),
    0
  );
  const lastCreated = payments[0]?.created_at
    ? new Date(payments[0].created_at).toLocaleString()
    : "—";

  // --- Search + Quick Filters for Payments Table ---
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredPayments = useMemo(() => {
    let result = payments;
    // Status filter
    if (statusFilter !== "All") {
      result = result.filter((p) => {
        const s = String(p.status || "").toLowerCase();
        if (statusFilter === "Paid") return s === "paid" || s === "success" || s.includes("complete");
        if (statusFilter === "Pending") return s === "pending";
        if (statusFilter === "Failed") return s.includes("fail") || s.includes("error");
        return true;
      });
    }
    // Query filter
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter((p) => {
        return (
          String(p.pf_payment_id ?? "").toLowerCase().includes(q) ||
          String(p.amount ?? "").toLowerCase().includes(q) ||
          String(p.status ?? "").toLowerCase().includes(q) ||
          String(p.id ?? "").toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [payments, query, statusFilter]);

  // Amount validation + nice blur formatting
  const numAmount = Number.parseFloat(String(amount).replace(",", "."));
  const amountValid = Number.isFinite(numAmount) && numAmount > 0;

  // Render a colored status badge
  const renderStatus = (status) => {
    const s = String(status || "").toUpperCase();
    if (s.includes("COMPLETE") || s === "SUCCESS" || s === "PAID") {
      return <span className="badge badge-ok">Complete</span>;
    }
    if (s.includes("FAIL") || s.includes("ERROR")) {
      return <span className="badge badge-err">Failed</span>;
    }
    return <span className="badge badge-warn">Pending</span>;
  };

  // --- Route handling (after hooks to satisfy rules-of-hooks) ---
  const path = typeof window !== "undefined" ? window.location.pathname : "/";

  // Show toasts for return/cancel routes (and optional auto-redirect)
  useEffect(() => {
    if (path.startsWith("/payfast/return")) {
      pushToast("ok", "Payment completed. Hit Refresh to see it listed.", "Success");
      const t = setTimeout(() => {
        window.location.href = "/?v=" + Date.now();
      }, 5000);
      return () => clearTimeout(t);
    }
    if (path.startsWith("/payfast/cancel")) {
      pushToast("warn", "Payment cancelled. No charges made.", "Heads-up");
    }
  }, [path]);

  // Auto-refresh payments every 30s (pause while busy or off main page)
  useEffect(() => {
    const t = setInterval(() => {
      const onMain =
        !path.startsWith("/payfast/") &&
        !path.startsWith("/deck");
      if (onMain && !busy) {
        loadPayments();
      }
    }, 30000);
    return () => clearInterval(t);
  }, [busy, path]); // loadPayments is stable enough for this interval use

  // Pretty "last updated Xs ago" string
  const lastAgo = lastRefreshAt
    ? Math.max(0, Math.floor((nowTick - lastRefreshAt) / 1000))
    : null;

  // Developer-only Deck route (gate with env key)
  if (path.startsWith("/deck")) {
    const deckEnvKey = (import.meta.env.VITE_DECK_KEY || "").trim();
    const url = new URL(window.location.href);
    const provided =
      url.searchParams.get("key") ||
      localStorage.getItem("churpay_deck_key") ||
      "";

    if (url.searchParams.get("key")) {
      localStorage.setItem("churpay_deck_key", provided);
      url.searchParams.delete("key");
      history.replaceState({}, "", url.pathname + url.search);
    }

    const isLocal =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const allowed = deckEnvKey ? provided === deckEnvKey : isLocal;

    if (allowed) return <Deck />;

    return (
      <div className="container">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Not Authorized</h1>
          <p className="muted">This internal presentation is restricted.</p>
          <DeckKeyForm
            expectedKey={deckEnvKey}
            onUnlock={() => (window.location.href = "/deck")}
          />
          <div style={{ marginTop: 8 }}>
            <a className="btn" href="/">Back to Home</a>
          </div>
        </div>
      </div>
    );
  }

  if (path.startsWith("/payfast/return")) {
    return (
      <div className="container">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Payment successful 🎉</h1>
        <p>We’ll refresh your dashboard in a moment so you can see it.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <a href="/" className="btn">Go now</a>
          </div>
        </div>
        <Toasts toasts={toasts} />
      </div>
    );
  }

  if (path.startsWith("/payfast/cancel")) {
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
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/logo.svg"
            alt="ChurPay logo"
            className="logo"
            onError={(e) => {
              const t = e.currentTarget;
              if (t.src.endsWith("logo.svg")) t.src = "/logo.png";
            }}
          />
          <div className="brand">
            <span>Chur</span>
            <span className="pay">Pay</span>
          </div>
        </div>
        {APP_ENV !== "production" && <span className="badge">Sandbox</span>}
      </div>

      {/* Hero */}
      <div className="hero" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, color: "var(--text)" }}>
          Seamless payments made simple.
        </div>
        <div
          className="points"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}
        >
          <div className="point">Fast checkout via PayFast</div>
          <div className="point">Secure IPN updates</div>
          <div className="point">Built for churches &amp; NPOs</div>
        </div>
      </div>

      {/* KPIs */}
      <div
        className="kpis"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          marginBottom: 12,
        }}
      >
        <div className="kpi">
          <div className="label">Total processed</div>
          <div className="value">{ZAR.format(totalZar)}</div>
        </div>
        <div className="kpi">
          <div className="label">Payments</div>
          <div className="value">{totalCount}</div>
        </div>
        <div className="kpi">
          <div className="label">Last payment</div>
          <div className="value">{lastCreated}</div>
        </div>
      </div>

      {/* Payment form */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <label className="label" htmlFor="amount">
            Amount (ZAR)
          </label>
          <input
            id="amount"
            className="input"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const n = Number.parseFloat(String(amount).replace(",", "."));
              if (Number.isFinite(n) && n > 0) setAmount(n.toFixed(2));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && amountValid && !busy) startPayment();
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => startPayment()}
            disabled={busy || !amountValid}
          >
            {busy ? "Starting…" : "Pay with PayFast (Sandbox)"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => startPayment(10)}
            disabled={busy}
            title="Quick R10 demo"
          >
            Demo R10
          </button>
        </div>
      </div>

      {/* Payments table */}
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}
        >
          <h2 style={{ margin: 0 }}>Recent Payments</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastAgo != null && (
              <div className="muted" title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : ""}>
                Last updated {lastAgo}s ago
              </div>
            )}
            <button className="btn" onClick={loadPayments} disabled={loadingPayments}>
              {loadingPayments ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {/* --- Filters Toolbar --- */}
        <div
          className="row"
          style={{
            gap: 8,
            alignItems: "center",
            marginTop: 10,
            marginBottom: 6,
            flexWrap: "wrap"
          }}
        >
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="text"
            placeholder="Search payments…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {["All", "Paid", "Pending", "Failed"].map((label) => (
              <button
                key={label}
                className={`btn${statusFilter === label ? " active" : ""}`}
                style={{ minWidth: 72 }}
                type="button"
                onClick={() => setStatusFilter(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="tableWrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>PF Payment ID</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {loadingPayments && payments.length === 0 ? (
                // Skeleton loader: 4 rows
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <tr key={"skeleton-" + i}>
                      <td data-label="ID">
                        <div className="skeleton-block" style={{ width: 32, height: 16 }} />
                      </td>
                      <td data-label="PF Payment ID">
                        <div className="skeleton-block" style={{ width: 80, height: 16 }} />
                      </td>
                      <td data-label="Amount">
                        <div className="skeleton-block" style={{ width: 60, height: 16 }} />
                      </td>
                      <td data-label="Status">
                        <div className="skeleton-block" style={{ width: 56, height: 16 }} />
                      </td>
                      <td data-label="Created">
                        <div className="skeleton-block" style={{ width: 100, height: 16 }} />
                      </td>
                    </tr>
                  ))}
                </>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No payments yet — try a quick demo.
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn-primary" onClick={() => startPayment(10)}>
                        Demo R10
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    No payments match your filters.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((p) => (
                  <tr key={p.id}>
                    <td data-label="ID">{p.id}</td>
                    <td data-label="PF Payment ID">
                      {p.pf_payment_id ? (
                        <span
                          className="copy-id"
                          onClick={() => copyToClipboard(p.pf_payment_id)}
                          title={copied[p.pf_payment_id] ? "Copied!" : "Click to copy"}
                        >
                          {p.pf_payment_id}
                          {copied[p.pf_payment_id] && (
                            <span className="copied-badge">Copied!</span>
                          )}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td data-label="Amount">
                      {typeof p.amount === "number" ? ZAR.format(p.amount) : p.amount ?? "-"}
                    </td>
                    <td data-label="Status">{renderStatus(p.status)}</td>
                    <td data-label="Created">
                      {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="footer">
          Data updates after PayFast IPN; refresh after completing a payment.
        </div>
      </div>

      <Toasts toasts={toasts} />
    </div>
  );
}