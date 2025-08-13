// frontend/src/pages/Admin.jsx
import { useEffect, useMemo, useState } from "react";
import "../App.css";

export default function Admin() {
  const [tab, setTab] = useState("overview"); // overview | payments | logs
  const [sys, setSys] = useState({ env: "", api: "", version: "" });
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [err, setErr] = useState("");
  const LOG_KEY = 'churpay_client_logs';
  const [logs, setLogs] = useState([]);

  const ZAR = useMemo(
    () => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }),
    []
  );
    // --- Tiny sparkline component (pure SVG, no libs) ---
  function _scaleSeries(series, width, height, pad = 2) {
    const n = series.length;
    if (n === 0) return { points: [] };
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1; // avoid div by zero
    const stepX = (width - pad * 2) / Math.max(1, n - 1);
    const pts = series.map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (v - min) / span);
      return [x, y];
    });
    return { points: pts, min, max };
  }

  function Sparkline({ series, width = 140, height = 36, showGrid = false, title }) {
    if (!series || series.length < 2) return null;
    const { points } = _scaleSeries(series, width, height);
    const d = points.map(([x,y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return (
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || 'trend'} focusable="false">
        {showGrid && (
          <g className="grid">
            <line x1="0" y1="18" x2={width} y2="18" />
          </g>
        )}
        <path d={d} />
      </svg>
    );
  }

  const readLogs = () => {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };
  const saveLogs = (arr) => {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); } catch {}
  };
  const addLog = (entry) => {
    const e = { ts: new Date().toISOString(), level: entry?.level || 'info', msg: entry?.msg || '', data: entry?.data || null };
    setLogs((prev) => {
      const next = [e, ...prev].slice(0, 500); // cap to 500
      saveLogs(next);
      return next;
    });
  };

  // Expose a global logger so other parts of the app can push logs
  useEffect(() => {
    if (!window.churpayLog) {
      window.churpayLog = (level, msg, data) => {
        try {
          const arr = readLogs();
          const e = { ts: new Date().toISOString(), level: level || 'info', msg: msg || '', data: data || null };
          const next = [e, ...arr].slice(0, 500);
          localStorage.setItem(LOG_KEY, JSON.stringify(next));
          // Notify this tab
          setLogs(next);
        } catch {}
      };
    }
  }, []);

  useEffect(() => {
    setLogs(readLogs());
    const onStorage = (e) => {
      if (e.key === LOG_KEY) setLogs(readLogs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const apiBase = (import.meta.env.VITE_API_URL || "").trim() || "";

  const loadHealth = async () => {
    try {
      const r = await fetch(`${apiBase}/api/health`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setSys({
        env: (import.meta.env.VITE_ENV || "").trim() || "development",
        api: r.ok ? "OK" : `HTTP ${r.status}`,
        version: j?.service || "backend",
      });
    } catch {
      setSys({ env: (import.meta.env.VITE_ENV || "").trim() || "development", api: "ERROR", version: "" });
    }
  };

  const loadPayments = async () => {
    try {
      setLoading(true);
      setErr("");
      const r = await fetch(`${apiBase}/api/payments`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (j?.rows || []);
      rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setPayments(rows);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const exportAllJSON = () => {
    const payload = { meta: { exported_at: new Date().toISOString(), count: payments.length }, rows: payments };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_payments_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportAllCSV = () => {
    const headers = ["id", "pf_payment_id", "amount", "status", "created_at"];
    const escape = (v) => `"${String(v ?? "").replace(/\\"/g, '""')}"`;
    const lines = [headers.join(",")].concat(
      payments.map((p) => [p.id, p.pf_payment_id, p.amount, p.status, p.created_at].map(escape).join(","))
    );
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all_payments_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    loadHealth();
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  const totalZar = payments.reduce(
    (acc, p) => acc + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0),
    0
  );

  const clearLogs = () => { saveLogs([]); setLogs([]); };
  const downloadLogs = () => {
    const payload = { meta: { exported_at: new Date().toISOString(), count: logs.length }, rows: logs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logs_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const simulateError = () => {
    try {
      throw new Error('Simulated error for testing');
    } catch (e) {
      window.churpayLog && window.churpayLog('error', e.message, { stack: e.stack });
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Admin</h1>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a className="btn" href="/settings">Settings</a>
            <a className="btn ghost" href="/">Back to Dashboard</a>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Environment: <strong>{sys.env || 'development'}</strong> · API: <strong>{sys.api || '—'}</strong>
        </div>
        {err && <div className="alert err" style={{ marginTop: 6 }}>Error: {err}</div>}
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(["overview", "payments", "logs"]).map((t) => (
            <button key={t} className={`btn ghost ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} aria-pressed={tab === t}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="card">
          <div className="kpis" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            <div className="kpi">
              <div className="label">Payments</div>
              <div className="value">{payments.length}</div>
            </div>
            <div className="kpi">
              <div className="label">Total processed</div>
              <div className="value">{ZAR.format(totalZar)}</div>
            </div>
            <div className="kpi">
              <div className="label">API status</div>
              <div className="value">{sys.api || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>All Payments</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn" onClick={loadPayments} disabled={loading} aria-busy={loading ? 'true' : 'false'}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <button className="btn ghost" onClick={exportAllCSV} disabled={payments.length === 0}>Export CSV</button>
              <button className="btn ghost" onClick={exportAllJSON} disabled={payments.length === 0}>Export JSON</button>
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
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">No payments loaded yet.</td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.pf_payment_id || '-'}</td>
                      <td>{typeof p.amount === 'number' ? ZAR.format(p.amount) : (p.amount ?? '-')}</td>
                      <td>{String(p.status || '').toUpperCase()}</td>
                      <td>{p.created_at ? new Date(p.created_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Client Logs</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn" onClick={downloadLogs} disabled={logs.length === 0}>Download JSON</button>
              <button className="btn ghost" onClick={clearLogs} disabled={logs.length === 0}>Clear</button>
              <button className="btn ghost" onClick={simulateError}>Simulate error</button>
            </div>
          </div>

          <div className="tableWrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Time</th>
                  <th style={{ width: 90 }}>Level</th>
                  <th>Message</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">No logs yet. Use “Simulate error” or call <code>window.churpayLog(level, msg, data)</code>.</td>
                  </tr>
                ) : (
                  logs.map((e, i) => (
                    <tr key={i}>
                      <td>{new Date(e.ts).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${e.level === 'error' ? 'badge-err' : e.level === 'warn' ? 'badge-warn' : 'badge-ok'}`}>
                          {e.level.toUpperCase()}
                        </span>
                      </td>
                      <td>{e.msg || '—'}</td>
                      <td>
                        {e.data ? (
                          <details>
                            <summary>view</summary>
                            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(e.data, null, 2)}</pre>
                          </details>
                        ) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}