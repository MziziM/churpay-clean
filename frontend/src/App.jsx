import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";
import Deck from "./Deck.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";
import Settings from "./pages/Settings.jsx";
import { isAuthed } from "./auth.js";
function PayfastReturn() {
  useEffect(() => {
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("payments:refresh"));
      } catch {}
    }, 1200);
  }, []);
  return (
    <div className="card" style={{ padding: 16, marginTop: 8 }}>
      <div className="alert ok" style={{ marginBottom: 12 }}>
        ✅ Payment complete. Welcome back!
      </div>
      <div className="row">
        <a className="btn btn-primary" href="/">
          View in history
        </a>
        <a className="btn ghost" href="/admin">
          Go to <span aria-hidden>🔒</span>&nbsp;Admin
        </a>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        If your payment isn’t visible yet, it’ll appear shortly after the IPN is received.
      </p>
    </div>
  );
}

function PayfastCancel() {
  return (
    <div className="card" style={{ padding: 16, marginTop: 8 }}>
      <div className="alert warn" style={{ marginBottom: 12 }}>
        ⚠️ Payment was cancelled.
      </div>
      <div className="row">
        <a className="btn btn-primary" href="/">
          Try again
        </a>
        <a className="btn ghost" href="/admin">
          Go to <span aria-hidden>🔒</span>&nbsp;Admin
        </a>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        No money moved. You can start a new payment anytime.
      </p>
    </div>
  );
}

// --- IPN Events Page ---
function IpnEventsPage({ apiBase }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expanded, setExpanded] = useState(new Set()); // which event IDs are expanded

  // --- small helpers (local to this page) ---
  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyJson = async (obj) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      alert('Copied JSON to clipboard');
    } catch { alert('Copy failed'); }
  };

  const toCSV = (rows) => {
    if (!rows || !rows.length) return '';
    const headers = ['id','pf_payment_id','m_payment_id','status','created_at'];
    const esc = (s) => '"' + String(s ?? '').replace(/"/g,'""') + '"';
    const lines = [headers.join(',')];
    for (const ev of rows) {
      const raw = ev.raw || {};
      lines.push([
        ev.id,
        ev.pf_payment_id || '',
        raw.m_payment_id || '',
        raw.payment_status || '',
        ev.created_at || ''
      ].map(esc).join(','));
    }
    return lines.join('\n');
  };

  const download = (name, mime, data) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportJSON = () => download(`ipn-events-${Date.now()}.json`, 'application/json', JSON.stringify(events, null, 2));
  const exportCSV = () => download(`ipn-events-${Date.now()}.csv`, 'text/csv', toCSV(events));

  const load = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      // Also support legacy ?ref= for direct links
      if (!q && params.size === 0) {
        const url = new URL(window.location.href);
        const ref = url.searchParams.get('ref');
        if (ref) params.set('ref', ref);
      }
      const r = await fetch(`${apiBase}/api/ipn-events?${params.toString()}`);
      const j = await r.json().catch(() => []);
      setEvents(Array.isArray(j) ? j : (j.rows || []));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* initial */ }, [apiBase]);

  return (
    <div className="container">
      <div className="topbar" style={{ boxShadow: '0 1px 0 var(--line)' }}>
        <a className="btn ghost" href="/">← Back</a>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={exportCSV} title="Download CSV">Export CSV</button>
          <button className="btn ghost" onClick={exportJSON} title="Download JSON">Export JSON</button>
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>IPN Events</h2>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" placeholder="Search (ref / m_payment_id)" value={q} onChange={(e)=>setQ(e.target.value)} style={{ width: 280 }} />
          <input type="date" className="input" value={fromDate} onChange={(e)=>setFromDate(e.target.value)} />
          <span className="muted">to</span>
          <input type="date" className="input" value={toDate} onChange={(e)=>setToDate(e.target.value)} />
          <button className="btn" onClick={load}>Apply</button>
          {(q || fromDate || toDate) && (
            <button className="btn ghost" onClick={()=>{ setQ(''); setFromDate(''); setToDate(''); load(); }}>Clear</button>
          )}
        </div>

        <div className="tableWrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>PF Payment ID</th>
                <th>Ref</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ width: 230 }}></th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={6} className="empty">No IPN events yet.</td></tr>
              ) : events.map(ev => {
                const ref = ev.raw?.m_payment_id || ev.merchant_reference || '';
                const isOpen = expanded.has(ev.id);
                return (
                  <>
                    <tr>
                      <td>{ev.id}</td>
                      <td>{ev.raw?.pf_payment_id || ev.pf_payment_id || '-'}</td>
                      <td>{ref || '-'}</td>
                      <td>{(ev.raw?.payment_status || ev.status || '').toString()}</td>
                      <td>{ev.created_at ? new Date(ev.created_at).toLocaleString() : '-'}</td>
                      <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {ref && (
                          <a className="btn ghost" href={`/?q=${encodeURIComponent(ref)}`} title="Find in payments table">View payment</a>
                        )}
                        <button className="btn ghost" onClick={() => copyJson(ev.raw || ev)} title="Copy raw JSON">Copy JSON</button>
                        <button className="btn" onClick={() => toggleExpand(ev.id)} title={isOpen ? 'Hide raw' : 'Show raw'}>
                          {isOpen ? 'Hide raw' : 'Show raw'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6}>
                          <pre style={{ margin: 0, padding: 12, background: 'var(--muted)', borderRadius: 8, overflowX: 'auto' }}>
{JSON.stringify(ev.raw || ev, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


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

function PayFastTopUpBox({ defaultAmount = 10, onPay }) {
  const [amt, setAmt] = useState(defaultAmount);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="topup-amount" className="label">Top up amount (ZAR)</label>
        <input
          id="topup-amount"
          type="number"
          min="1"
          step="1"
          className="input"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        <button
          className="btn btn-primary"
          onClick={() => onPay?.(amt)}
        >
          <span aria-hidden>💳</span>&nbsp;Pay with PayFast
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        You’ll be redirected to PayFast to complete the payment. After payment, you’ll return here and the status will update via IPN.
      </p>
    </div>
  );
}

export default function App() {
  // Listen for payments:refresh event to reload payments
  useEffect(() => {
    const handler = () => loadPayments?.();
    window.addEventListener("payments:refresh", handler);
    return () => window.removeEventListener("payments:refresh", handler);
  }, []);
  const apiBase = (() => {
    const v = (import.meta?.env?.VITE_API_URL || "").trim().replace(/\/$/, "");
    if (v) return v;
    if (typeof window !== "undefined") {
      return window.location.hostname.includes("churpay.com")
        ? "https://api.churpay.com"
        : "http://localhost:5000";
    }
    return "";
  })();
  const APP_ENV = (import.meta.env.VITE_ENV || "").trim().toLowerCase(); // "production" hides Sandbox badge

  const [health, setHealth] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [amount, setAmount] = useState("50.00");
  const [busy, setBusy] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [toasts, setToasts] = useState([]);
  // IPN Events count for topbar badge
  const [ipnCount, setIpnCount] = useState(null);
  const nextId = useRef(1);

  const [copied, setCopied] = useState({});
  // Backend base URL (Vite env for prod, empty for same-origin in dev)
  const API_BASE = (import.meta?.env?.VITE_API_URL || '').replace(/\/$/, '');
  const [lastRefreshAt, setLastRefreshAt] = useState(0); // timestamp of last successful refresh
  const [nowTick, setNowTick] = useState(Date.now());   // re-render every second for "X seconds ago"
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All"); // All | Paid | Pending | Failed
  const [dateRange, setDateRange] = useState("All");       // All | Today | 7d | 30d
  const [fromDate, setFromDate] = useState(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState("");   // YYYY-MM-DD
  const [page, setPage] = useState(1);
  const savedPageSize = Number(localStorage.getItem("churpay_default_page_size") || "10") || 10;
  const [pageSize, setPageSize] = useState(savedPageSize);
  const [detail, setDetail] = useState(null); // selected payment for detail modal
  const [usedLocalFallback, setUsedLocalFallback] = useState(false);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState(null); // string | null
  const [sortBy, setSortBy] = useState("created_at"); // id | pf_payment_id | amount | status | created_at
  const [sortDir, setSortDir] = useState("desc"); 
  const [exportScope, setExportScope] = useState('filtered'); // 'filtered' | 'all'     // asc | desc
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('churpay_compact') === 'true'; } catch { return false; }
  });
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Settings from backend (brand color + sandbox badge)
  const [brand, setBrand] = useState("#6b4fff");
  const [sandboxMode, setSandboxMode] = useState(null); // null = unknown (fall back to env)

  // Topbar brand style: live (sandboxMode=false) uses brand background
  const topbarStyle = useMemo(() => {
    if (sandboxMode === false) {
      return { background: 'var(--brand)', color: '#fff', boxShadow: '0 1px 0 rgba(0,0,0,0.06)' };
    }
    return { boxShadow: '0 1px 0 var(--line)' };
  }, [sandboxMode]);

  // Form-post flow direct to PayFast via our server (avoids 400s)
  const openPayFastForm = (amountNumber) => {
    const amount = Number(amountNumber || 0);
    if (!isFinite(amount) || amount <= 0) {
      pushToast("err", "Enter a valid amount");
      return;
    }
    const backend = (apiBase && apiBase.trim()) || (window.location.hostname.includes("churpay.com") ? "https://api.churpay.com" : "http://localhost:5000");
    const url = `${backend}/api/payfast/initiate-form?amount=${encodeURIComponent(amount.toFixed(2))}`;
    window.location.href = url;
  };
  useEffect(() => {
    try { localStorage.setItem('churpay_compact', compact ? 'true' : 'false'); } catch {}
  }, [compact]);
  const PRESET_KEY = 'churpay_filter_presets';
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
  });
  const [presetName, setPresetName] = useState('');
  useEffect(() => {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch {}
  }, [presets]);

  // Escape-to-close for the modal
  useEffect(() => {
    if (!detail) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);
const searchRef = useRef(null);

  const ZAR = useMemo(
    () => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }),
    []
  );
  // --- Export helpers (CSV/JSON) ---
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCSV(rows) {
    if (!rows || !rows.length) return '';
    // Collect all keys across rows so we don’t lose fields
    const allKeys = Array.from(
      rows.reduce((set, r) => { Object.keys(r || {}).forEach(k => set.add(k)); return set; }, new Set())
    );
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const head = allKeys.join(',');
    const body = rows.map(r => allKeys.map(k => esc(r?.[k])).join(',')).join('\n');
    return head + '\n' + body;
  }

  function exportCSV(rows, filename = `payments_${new Date().toISOString().slice(0,10)}.csv`) {
    const csv = toCSV(rows || []);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename);
  }

  function exportJSON(rows, filename = `payments_${new Date().toISOString().slice(0,10)}.json`) {
    const json = JSON.stringify(rows || [], null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, filename);
  }
  // --- Highlight helper for search matches ---
  function highlightText(value, queryStr) {
    const text = value == null ? '' : String(value);
    const q = (queryStr || '').trim();
    if (!q) return text;
    try {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'ig');
      const parts = text.split(re);
      const matches = text.match(re) || [];
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) out.push(<span key={`p${i}`}>{parts[i]}</span>);
        if (i < matches.length) out.push(<mark key={`m${i}`}>{matches[i]}</mark>);
      }
      return <>{out}</>;
    } catch {
      return text;
    }
  }

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

  function Sparkline({ series, width = 180, height = 36, showGrid = false, title }) {
    if (!series || series.length < 2) return null;
    const { points } = _scaleSeries(series, width, height);
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
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

  const pushToast = (type, msg, title) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, type, msg, title }]);
    // mirror to client logs
    const level = type === 'err' ? 'error' : (type === 'warn' ? 'warn' : 'info');
    try { window.churpayLog && window.churpayLog(level, title ? `${title}: ${msg}` : msg); } catch {}
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  };
  useEffect(() => {
    const onWindowError = (message, source, lineno, colno, error) => {
      try { window.churpayLog && window.churpayLog('error', 'Uncaught error', { message, source, lineno, colno, stack: error?.stack }); } catch {}
    };
    const onUnhandledRejection = (e) => {
      try { window.churpayLog && window.churpayLog('error', 'Unhandled promise rejection', { reason: e?.reason }); } catch {}
    };
    const prev = window.onerror;
    window.onerror = onWindowError;
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.onerror = prev || null;
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

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

    // Copy any object as pretty JSON
  const copyJsonToClipboard = (obj) => {
    try {
      const txt = JSON.stringify(obj ?? {}, null, 2);
      navigator.clipboard.writeText(txt)
        .then(() => pushToast('ok', 'Copied row JSON to clipboard'))
        .catch(() => pushToast('err', 'Failed to copy JSON'));
    } catch {
      pushToast('err', 'Could not serialise row');
    }
  };

  // Re-run PayFast checks for a given reference (admin/debug tool)
  async function revalidatePaymentByRef(ref) {
    if (!ref) { pushToast('err', 'Missing reference'); return; }
    try {
      setRevalidating(true);
      const res = await fetch(`${API_BASE}/api/payfast/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ref })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('err', data?.error || 'Revalidate failed');
        return;
      }
      const { ok, checks = {} } = data;
      const parts = [];
      if (typeof checks.sigOk !== 'undefined') parts.push(`sig:${checks.sigOk ? '✓' : '✗'}`);
      if (typeof checks.merchantOk !== 'undefined') parts.push(`merchant:${checks.merchantOk ? '✓' : '✗'}`);
      if (typeof checks.remoteOk !== 'undefined') parts.push(`remote:${checks.remoteOk ? '✓' : '✗'}`);
      if (typeof checks.amountOk !== 'undefined') parts.push(`amount:${checks.amountOk ? '✓' : '✗'}`);
      pushToast(ok ? 'ok' : 'warn', `Revalidated (${parts.join(' • ')})`);
      try { await loadPayments(); } catch {}
    } catch {
      pushToast('err', 'Revalidate error');
    } finally {
      setRevalidating(false);
    }
  }

  // --- Admin actions (guarded by backend; will no-op if 401/404) ---
  async function markPaymentStatus(id, status) {
    try {
      const res = await fetch(`${API_BASE}/api/admin/payments/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { pushToast('err', j?.error || `Failed to mark ${status}`); return; }
      pushToast('ok', `Marked ${id} → ${status}`);
      try { await loadPayments(); } catch {}
    } catch {
      pushToast('err', 'Network error');
    }
  }

  async function addNoteToPayment(id) {
    const note = prompt('Add note for payment #' + id + ':');
    if (!note) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/payments/${id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ note })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { pushToast('err', j?.error || 'Failed to add note'); return; }
      pushToast('ok', 'Note added');
      try { await loadPayments(); } catch {}
    } catch {
      pushToast('err', 'Network error');
    }
  }

  async function addTagToPayment(id) {
    const tag = prompt('Add tag for payment #' + id + ' (e.g., youth, event, tithe):');
    if (!tag) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/payments/${id}/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tag })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { pushToast('err', j?.error || 'Failed to add tag'); return; }
      pushToast('ok', `Tag added: ${tag}`);
      try { await loadPayments(); } catch {}
    } catch {
      pushToast('err', 'Network error');
    }
  }

  const loadHealth = async () => {
    try {
      const r = await fetch(`${apiBase}/api/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      setHealth(j);
      try { window.churpayLog && window.churpayLog('info', 'Health check', { ok: !!j?.ok }); } catch {}
      if (j?.ok) pushToast("ok", "API is reachable.", "Health: OK");
      else pushToast("err", "Backend health returned ERROR.", "Health");
    } catch (e) {
      try { window.churpayLog && window.churpayLog('error', 'Health check failed', { error: String(e?.message || e) }); } catch {}
      setHealth({ ok: false, error: String(e?.message || e) });
      pushToast("err", "Failed to reach backend health.", "Network");
    }
  };

  const loadPayments = async () => {
    const pickRows = (j) => (Array.isArray(j) ? j : j?.rows || []);
    try {
      setLoadingPayments(true);
      setUsedLocalFallback(false);
      setCacheUpdatedAt(null);
      try { window.churpayLog && window.churpayLog('info', 'Loading payments…'); } catch {}

      // Try live API first
      const r = await fetch(`${apiBase}/api/payments`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      const rows = pickRows(j);
      rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setPayments(rows);
      setLastRefreshAt(Date.now());
      try { window.churpayLog && window.churpayLog('info', 'Loaded payments from API', { count: rows.length }); } catch {}
      pushToast("ok", `Payments refreshed (${rows.length})`, "Success");
    } catch (e) {
      // Fallback to local exported JSON
      try {
        const r2 = await fetch(`/data/payments.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!r2.ok) throw new Error(`Fallback HTTP ${r2.status}`);
        const j2 = await r2.json();
        const rows2 = pickRows(j2);
        rows2.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        setPayments(rows2);
        setLastRefreshAt(Date.now());
        setUsedLocalFallback(true);
        const metaTs = j2?.meta?.updated_at || j2?.updated_at || null;
        if (metaTs) setCacheUpdatedAt(metaTs);
        else if (rows2[0]?.created_at) setCacheUpdatedAt(rows2[0].created_at);
        try { window.churpayLog && window.churpayLog('warn', 'Loaded payments from local cache', { count: rows2.length, cacheUpdatedAt: j2?.meta?.updated_at || j2?.updated_at || null }); } catch {}
        pushToast("warn", `Loaded ${rows2.length} from local cache.`, "Offline mode");
      } catch (e2) {
        try { window.churpayLog && window.churpayLog('error', 'Payments load failed (API & cache)', { apiError: String(e?.message || e), cacheError: String(e2?.message || e2) }); } catch {}
        pushToast("err", "Could not load payments (API & local cache failed).");
      }
    } finally {
      setLoadingPayments(false);
    }
  };

  // Lightweight IPN events count loader (tries ?count=1 first, falls back to array length)
  const loadIpnCount = async () => {
    try {
      const url = new URL(`${apiBase}/api/ipn-events`);
      url.searchParams.set('limit', '1');
      url.searchParams.set('count', '1');
      const r = await fetch(url.toString(), { cache: 'no-store' });
      const j = await r.json().catch(() => ([]));
      let count = null;
      if (j && typeof j.count === 'number') {
        count = j.count;
      } else if (Array.isArray(j)) {
        count = j.length;
      } else if (j && Array.isArray(j.rows)) {
        count = j.rows.length;
      }
      if (count !== null) setIpnCount(count);
    } catch {
      // keep previous ipnCount on error
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
        try { window.churpayLog && window.churpayLog('info', 'Redirecting to PayFast', { amount: num.toFixed(2) }); } catch {}
        pushToast("ok", `Redirecting to PayFast for ${ZAR.format(num)}…`);
        window.location.href = j.redirect;
      } else {
        pushToast("err", "Failed to start payment.");
      }
    } catch (e) {
      try { window.churpayLog && window.churpayLog('error', 'startPayment error', { error: String(e?.message || e) }); } catch {}
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
    loadIpnCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Tick every second to update "Last updated Xs ago"
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh IPN count every 60s and when tab becomes visible
  useEffect(() => {
    const t = setInterval(() => loadIpnCount(), 60000);
    const onVis = () => { if (document.visibilityState === 'visible') loadIpnCount(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [apiBase]);

  // KPIs
  const totalCount = payments.length;
  const totalZar = payments.reduce(
    (acc, p) => acc + (typeof p.amount === "number" ? p.amount : Number(p.amount) || 0),
    0
  );
  const lastCreated = payments[0]?.created_at
    ? new Date(payments[0].created_at).toLocaleString()
    : "—";

  // --- Build daily series for last 14 days (inclusive of today) ---
  const { daysLabels, dailyCountSeries, dailyAmountSeries } = useMemo(() => {
    const DAYS = 14;
    const days = [];
    const fmt = (d) => d.toISOString().slice(0,10);
    const today = new Date();
    // Build keys for last DAYS chronologically
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(fmt(d));
    }
    const countMap = Object.fromEntries(days.map(k => [k, 0]));
    const amtMap = Object.fromEntries(days.map(k => [k, 0]));
    for (const p of payments) {
      if (!p.created_at) continue;
      const k = fmt(new Date(p.created_at));
      if (k in countMap) {
        countMap[k] += 1;
        const v = typeof p.amount === 'number' ? p.amount : Number(p.amount) || 0;
        amtMap[k] += v;
      }
    }
    return {
      daysLabels: days,
      dailyCountSeries: days.map(k => countMap[k]),
      dailyAmountSeries: days.map(k => Number(amtMap[k].toFixed(2))),
    };
  }, [payments]);


  // --- Sort helper ---
  const sortRows = (rows, by, dir) => {
    const mul = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const A = a?.[by];
      const B = b?.[by];
      if (by === "amount") {
        const nA = typeof A === "number" ? A : Number(A) || 0;
        const nB = typeof B === "number" ? B : Number(B) || 0;
        return (nA - nB) * mul;
      }
      if (by === "created_at") {
        const tA = A ? new Date(A).getTime() : 0;
        const tB = B ? new Date(B).getTime() : 0;
        return (tA - tB) * mul;
      }
      const sA = String(A ?? "");
      const sB = String(B ?? "");
      return sA.localeCompare(sB) * mul;
    });
  };

  // --- Search + Quick Filters + Date Range for Payments Table ---
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

    // Date range filter
    if (dateRange !== "All") {
      const now = new Date();
      if (dateRange === "Today") {
        const todayStr = now.toDateString();
        result = result.filter((p) => p.created_at && new Date(p.created_at).toDateString() === todayStr);
      } else {
        const days = dateRange === "7d" ? 7 : 30;
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - days);
        result = result.filter((p) => p.created_at && new Date(p.created_at) >= cutoff);
      }
    }

    // Custom from/to (takes precedence if provided)
    if (fromDate || toDate) {
      const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
      const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
      result = result.filter((p) => {
        if (!p.created_at) return false;
        const ts = new Date(p.created_at).getTime();
        if (fromTs && ts < fromTs) return false;
        if (toTs && ts > toTs) return false;
        return true;
      });
    }

    // Text query (debounced)
    if (qDebounced.trim()) {
      const q = qDebounced.trim().toLowerCase();
      result = result.filter((p) => {
        const idStr = String(p.id ?? "");
        const pfid = String(p.pf_payment_id ?? "");
        const ref = String(p.merchant_reference ?? "");
        const email = String(p.payer_email ?? "");
        const name = String(p.payer_name ?? "");
        const amt = typeof p.amount === "number" ? String(p.amount) : String(p.amount ?? "");
        const s = String(p.status ?? "").toLowerCase();
        return (
          idStr.toLowerCase().includes(q) ||
          pfid.toLowerCase().includes(q) ||
          ref.toLowerCase().includes(q) ||
          email.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          amt.toLowerCase().includes(q) ||
          s.includes(q)
        );
      });
    }

    return sortRows(result, sortBy, sortDir);
  }, [payments, qDebounced, statusFilter, dateRange, fromDate, toDate, sortBy, sortDir]);

  const totalFiltered = filteredPayments.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageNumbers = useMemo(() => {
    const maxButtons = 7; // window size for numbered buttons
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxButtons - 1);
    if (end - start + 1 < maxButtons) {
      start = Math.max(1, end - maxButtons + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);
  const startIndex = (currentPage - 1) * pageSize;
  const pagedPayments = filteredPayments.slice(startIndex, startIndex + pageSize);
  useEffect(() => { setPage(1); }, [qDebounced, statusFilter, dateRange, pageSize, fromDate, toDate]);

  // Amount validation + nice blur formatting
  const numAmount = Number.parseFloat(String(amount).replace(",", "."));
  const amountValid = Number.isFinite(numAmount) && numAmount > 0;

  // Render a colored status badge with icon
  const renderStatus = (status) => {
    const s = String(status || "").toUpperCase();
    if (s.includes("COMPLETE") || s === "SUCCESS" || s === "PAID") {
      return <span className="badge badge-ok">✔︎ Complete</span>;
    }
    if (s.includes("FAIL") || s.includes("ERROR")) {
      return <span className="badge badge-err">✖︎ Failed</span>;
    }
    return <span className="badge badge-warn">• Pending</span>;
  };


  const resetFilters = () => {
    setQuery("");
    setStatusFilter("All");
    setDateRange("All");
    setFromDate("");
    setToDate("");
    setPage(1);
    setSortBy("created_at");
    setSortDir("desc");
  };
  const currentFilterState = () => ({
    query, statusFilter, dateRange, fromDate, toDate, sortBy, sortDir, pageSize, compact
  });
  const getExportRows = () => (exportScope === 'all' ? payments : filteredPayments);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea';
      if (!typing && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (!typing && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (!loadingPayments) loadPayments();
      }
      if (!typing && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const rows = getExportRows();
        if (rows.length) exportCSV(rows);
      }
      if (!typing && e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage((p) => Math.max(1, p - 1));
      }
      if (!typing && e.key === 'ArrowRight') {
        e.preventDefault();
        setPage((p) => Math.min(totalPages, p + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadingPayments, totalPages, exportScope, payments, filteredPayments]);

  const isSamePreset = (p) => {
    if (!p) return false;
    const cur = currentFilterState();
    return (
      (p.query ?? '') === cur.query &&
      (p.statusFilter ?? 'All') === cur.statusFilter &&
      (p.dateRange ?? 'All') === cur.dateRange &&
      (p.fromDate ?? '') === cur.fromDate &&
      (p.toDate ?? '') === cur.toDate &&
      (p.sortBy ?? 'created_at') === cur.sortBy &&
      (p.sortDir ?? 'desc') === cur.sortDir &&
      (p.pageSize ?? 10) === cur.pageSize &&
      (!!p.compact) === !!cur.compact
    );
  };

  const activePreset = useMemo(() => {
    for (const p of presets) {
      if (isSamePreset(p)) return p;
    }
    return null;
  }, [presets, query, statusFilter, dateRange, fromDate, toDate, sortBy, sortDir, pageSize, compact]);

  const canUpdatePreset = useMemo(() => (
    activePreset ? !isSamePreset(activePreset) : false
  ), [activePreset, query, statusFilter, dateRange, fromDate, toDate, sortBy, sortDir, pageSize, compact]);

  const applyPreset = (p) => {
    if (!p) return;
    setQuery(p.query ?? '');
    setStatusFilter(p.statusFilter ?? 'All');
    setDateRange(p.dateRange ?? 'All');
    setFromDate(p.fromDate ?? '');
    setToDate(p.toDate ?? '');
    setSortBy(p.sortBy ?? 'created_at');
    setSortDir(p.sortDir ?? 'desc');
    setPageSize(p.pageSize ?? 10);
    setCompact(!!p.compact);
    setPage(1);
    pushToast('ok', `Applied preset${p.name ? `: ${p.name}` : ''}`);
  };

  const savePreset = () => {
    const name = (presetName || '').trim();
    if (!name) { pushToast('warn', 'Give your preset a name first.'); return; }
    const snapshot = { name, ...currentFilterState() };
    setPresets((list) => {
      const others = list.filter((x) => x.name !== name);
      return [...others, snapshot];
    });
    setPresetName('');
    pushToast('ok', 'Preset saved.');
  };

  const deletePreset = (name) => {
    setPresets((list) => list.filter((x) => x.name !== name));
    pushToast('warn', `Deleted preset: ${name}`);
  };

  const updatePreset = () => {
    if (!activePreset?.name) { pushToast('warn', 'No active preset to update.'); return; }
    const name = activePreset.name;
    const snapshot = { name, ...currentFilterState() };
    setPresets((list) => {
      const others = list.filter((x) => x.name !== name);
      return [...others, snapshot];
    });
    pushToast('ok', `Updated preset: ${name}`);
  };

  // --- Route handling (after hooks to satisfy rules-of-hooks) ---
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  // Load settings from backend and apply CSS brand
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/settings`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) {
          if (j?.brandColor) {
            setBrand(j.brandColor);
            try { document.documentElement.style.setProperty('--brand', j.brandColor); } catch {}
          }
          if (typeof j?.sandboxMode === 'boolean') setSandboxMode(j.sandboxMode);
        }
      } catch (e) {
        // fallback: keep defaults; env will decide sandbox badge
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  // If brand state changes later for any reason, re-apply
  useEffect(() => {
    try { document.documentElement.style.setProperty('--brand', brand); } catch {}
  }, [brand]);

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
// ----- Auth routes -----
if (path === "/login") {
  return <Login />;
}

function Drawer({ open, onClose, children, title, width = 420 }) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" style={{ width }} onClick={(e)=>e.stopPropagation()}>
        <div className="drawer-head">
          <h3 style={{ margin: 0 }}>{title || "Details"}</h3>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
if (path === "/admin") {
  return isAuthed() ? <Admin /> : (window.location.href = "/login?reason=auth", null);
}
if (path === "/settings") {
  // protect settings
  return isAuthed() ? <Settings /> : (window.location.href = "/login?reason=auth", null);
}

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

  // IPN Events page route
  if (path.startsWith('/ipn-events')) {
    return <IpnEventsPage apiBase={apiBase} />;
  }
  // React-router routes for payfast return/cancel
  // If react-router is not set up, fallback to old path check
  if (path.startsWith("/payfast/return")) {
    return (
      <div className="container">
        <PayfastReturn />
        <Toasts toasts={toasts} />
      </div>
    );
  }
  if (path.startsWith("/payfast/cancel")) {
    return (
      <div className="container">
        <PayfastCancel />
        <Toasts toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="topbar" style={topbarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
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
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {((sandboxMode === true) || (sandboxMode === null && APP_ENV !== 'production')) && (
            <span className="badge">Sandbox</span>
          )}
          {/* Live health + last updated badges */}
          {health?.ok ? (
            <span className="badge badge-ok" title="Backend reachable">API OK</span>
          ) : health ? (
            <span className="badge badge-err" title="Backend not reachable">API Down</span>
          ) : null}
          {lastAgo != null && (
            <span className="badge ghost" title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : ''}>
              Updated {lastAgo}s ago
            </span>
          )}
      <nav className="topnav" aria-label="Main">
        <a className="btn ghost" href="/ipn-events" title="View IPN callbacks" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden>🛰️</span>&nbsp;IPN Events
          {typeof ipnCount === 'number' && ipnCount > 0 ? (
            <span className="badge" style={{ marginLeft: 6 }}>{ipnCount}</span>
          ) : null}
        </a>
        <a className="btn ghost" href="/settings" title="Open Settings">
          <span aria-hidden>⚙️</span>&nbsp;Settings
        </a>
        <a className="btn ghost" href="/admin" title="Open Admin">
          <span aria-hidden>🔒</span>&nbsp;Admin
        </a>
      </nav>
        </div>
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

      {/* Quick Top-Up (Form POST flow) */}
      <PayFastTopUpBox defaultAmount={10} onPay={openPayFastForm} />

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi">
          <div className="label">Total processed</div>
          <div className="value">{ZAR.format(totalZar)}</div>
          <Sparkline series={dailyAmountSeries} width={180} height={36} showGrid title="Amount trend (14d)" />
        </div>
        <div className="kpi">
          <div className="label">Payments</div>
          <div className="value">{totalCount}</div>
          <Sparkline series={dailyCountSeries} width={180} height={36} showGrid title="Count trend (14d)" />
        </div>
        <div className="kpi">
          <div className="label">Last payment</div>
          <div className="value">{lastCreated}</div>
          <Sparkline series={dailyCountSeries} width={180} height={36} title="Recent activity" />
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
            {busy ? "Starting…" : "💳 Pay with PayFast"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => startPayment(10)}
            disabled={busy}
            title="Quick R10 demo"
          >
            <span aria-hidden>🧪</span>&nbsp;Demo R10
          </button>
          <button
            className="btn"
            onClick={() => openPayFastForm(amount)}
            disabled={!amountValid}
            title="Use server form (POST)"
          >
            <span aria-hidden>↗️</span>&nbsp;Open PayFast (Form)
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {[10, 50, 100, 250].map((v) => (
            <button key={v} type="button" className="btn ghost" onClick={() => setAmount(v.toFixed(2))}>
              R{v}
            </button>
          ))}
        </div>
      </div>

      {/* Payments table */}
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}
        >
          <h2 style={{ margin: 0 }}>Recent Payments</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: 'wrap' }}>
            {activePreset && (
              <>
                <span className="badge" title="Current filters match this preset">
                  Preset: {activePreset.name}
                </span>
                <button
                  className="btn"
                  onClick={updatePreset}
                  disabled={!canUpdatePreset}
                  title={canUpdatePreset ? "Overwrite this preset with current filters" : "No changes to update"}
                >
                  Update preset
                </button>
                <button
                  className="btn ghost"
                  onClick={resetFilters}
                  title="Clear current filters and preset"
                >
                  Clear preset
                </button>
              </>
            )}
            {usedLocalFallback && (
              <span className="badge badge-warn" title={cacheUpdatedAt ? `Cache from ${new Date(cacheUpdatedAt).toLocaleString()}` : "Using local data"}>
                Offline data
              </span>
            )}
            {lastAgo != null && (
              <div className="muted" title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : ""}>
                Last updated {lastAgo}s ago
              </div>
            )}
            {usedLocalFallback && cacheUpdatedAt && (
              <div className="muted">(cache @ {new Date(cacheUpdatedAt).toLocaleString()})</div>
            )}
            <button className="btn" onClick={loadPayments} disabled={loadingPayments} aria-busy={loadingPayments ? 'true' : 'false'}>
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
            flexWrap: "wrap",
          }}
        >
          <input
            ref={searchRef}
            className="input"
            placeholder="🔎 Search by ID, PF ID, amount, or status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />

          {/* Status quick filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["All", "Paid", "Pending", "Failed"].map((label) => (
              <button
                key={label}
                type="button"
                className={`btn ghost ${statusFilter === label ? "active" : ""}`}
                onClick={() => setStatusFilter(label)}
                aria-pressed={statusFilter === label}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date quick filters + custom from/to */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {["All", "Today", "7d", "30d"].map((r) => (
              <button
                key={r}
                type="button"
                className={`btn ghost ${dateRange === r ? "active" : ""}`}
                onClick={() => {
                  setDateRange(r);
                  setFromDate("");
                  setToDate("");
                }}
                aria-pressed={dateRange === r}
              >
                {r}
              </button>
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input
                type="date"
                className="input"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setDateRange("All");
                }}
                aria-label="From date"
                style={{ width: 160 }}
              />
              <span className="muted">to</span>
              <input
                type="date"
                className="input"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setDateRange("All");
                }}
                aria-label="To date"
                style={{ width: 160 }}
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  title="Clear custom dates"
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>

          {/* Export toolbar */}
          <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <label className="label" htmlFor="export-scope" title="Choose which rows to export">
              Export
            </label>
            <select
              id="export-scope"
              className="input"
              style={{ width: 140 }}
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
              aria-label="Export scope"
            >
              <option value="filtered">Filtered</option>
              <option value="all">All</option>
            </select>
            <button
              type="button"
              className="btn ghost"
              onClick={() => exportCSV(getExportRows())}
              disabled={getExportRows().length === 0}
              title={exportScope === "all" ? "Download ALL rows as CSV" : "Download FILTERED rows as CSV"}
            >
              <span aria-hidden>⬇️</span>&nbsp;Export CSV
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => exportJSON(getExportRows())}
              disabled={getExportRows().length === 0}
              title={exportScope === "all" ? "Download ALL rows as JSON" : "Download FILTERED rows as JSON"}
            >
              <span aria-hidden>⬇️</span>&nbsp;Export JSON
            </button>
          </div>

          {/* Reset + paging + compact toggle */}
          <button
            type="button"
            className="btn"
            onClick={resetFilters}
            title="Clear search, filters and dates"
          >
            Reset filters
          </button>
          <select
            className="input"
            style={{ width: 120 }}
            value={pageSize}
            onChange={(e) => {
              const v = Number(e.target.value) || 10;
              setPageSize(v);
              try {
                localStorage.setItem("churpay_default_page_size", String(v));
              } catch {}
            }}
            aria-label="Rows per page"
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
          </select>
          <label className="switch" title="Compact rows">
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => setCompact(e.target.checked)}
            />
            <span className="track">
              <span className="thumb" />
            </span>
            <span className="muted">Compact</span>
          </label>

          {/* Presets */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Preset name…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              style={{ width: 160 }}
            />
            <button type="button" className="btn" onClick={savePreset}>
              Save preset
            </button>
            <select
              className="input"
              style={{ width: 180 }}
              onChange={(e) => {
                const name = e.target.value;
                if (!name) return;
                const p = presets.find((x) => x.name === name);
                applyPreset(p);
                e.target.selectedIndex = 0;
              }}
            >
              <option value="">Load preset…</option>
              {presets
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const name = prompt("Delete which preset? Enter the exact name:");
                if (name) deletePreset(name);
              }}
              title="Delete a saved preset by name"
            >
              Delete preset
            </button>
          </div>
        </div>
       <div className="tableWrap" style={{ marginTop: 8, maxHeight: '60vh', overflow: 'auto' }}>
          <table className={`table ${compact ? 'compact' : ''}`}>
            <thead>
              <tr>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("id");
                    setSortDir(d => (sortBy === "id" ? (d === "asc" ? "desc" : "asc") : "asc"));
                  }}>
                    ID {sortBy === "id" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("pf_payment_id");
                    setSortDir(d => (sortBy === "pf_payment_id" ? (d === "asc" ? "desc" : "asc") : "asc"));
                  }}>
                    PF Payment ID {sortBy === "pf_payment_id" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("merchant_reference");
                    setSortDir(d => (sortBy === "merchant_reference" ? (d === "asc" ? "desc" : "asc") : "asc"));
                  }}>
                    Reference {sortBy === "merchant_reference" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("amount");
                    setSortDir(d => (sortBy === "amount" ? (d === "asc" ? "desc" : "asc") : "asc"));
                  }}>
                    Amount {sortBy === "amount" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("status");
                    setSortDir(d => (sortBy === "status" ? (d === "asc" ? "desc" : "asc") : "asc"));
                  }}>
                    Status {sortBy === "status" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th>
                  <button className="th-sort" onClick={() => {
                    setSortBy("created_at");
                    setSortDir(d => (sortBy === "created_at" ? (d === "asc" ? "desc" : "asc") : "desc"));
                  }}>
                    Created {sortBy === "created_at" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
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
                      <td data-label="Reference">
                        <div className="skeleton-block" style={{ width: 110, height: 16 }} />
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
                  <td colSpan={6} className="empty" style={{ textAlign: 'left' }}>
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Welcome to ChurPay 👋</h3>
                        <div className="muted" style={{ marginTop: 4 }}>Here’s how to see payments appear:</div>
                      </div>
                      <ol style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
                        <li>Use the amount box above and click <strong>Pay with PayFast</strong> (Sandbox).</li>
                        <li>Complete the PayFast flow; you’ll return here automatically.</li>
                        <li>Click <strong>Refresh</strong> to load the updated list.</li>
                      </ol>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={() => startPayment(10)}>Try Demo R10</button>
                        <a className="btn" href="/login" title="Admin only">Admin Login</a>
                      </div>
                      <div className="muted">Tip: use the filters above to search or narrow by status/date.</div>
                    </div>
                  </td>
                </tr>
              ) : filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No payments match your filters.
                    <div style={{ marginTop: 8 }}>
                      <button className="btn" onClick={resetFilters}>Clear filters</button>
                    </div>
                  </td>
                </tr>
              ) : (
                pagedPayments.map((p) => (
                  <tr key={p.id} className="row-click" onClick={(e) => {
                    const tag = (e.target.tagName || '').toLowerCase();
                    if (tag === 'button' || tag === 'a' || tag === 'input') return; // let buttons/links work
                    setDetail(p);
                  }}>
                    <td data-label="ID">{highlightText(p.id, qDebounced)}</td>
                    <td data-label="PF Payment ID">
                      {p.pf_payment_id ? (
                        <span
                          className="copy-id"
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(p.pf_payment_id); }}
                          title={copied[p.pf_payment_id] ? "Copied!" : "Click to copy"}
                        >
                          {highlightText(p.pf_payment_id, qDebounced)}
                          {copied[p.pf_payment_id] && (
                            <span className="copied-badge">Copied!</span>
                          )}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td data-label="Reference">
                      {p.merchant_reference ? (
                        <span
                          className="copy-id"
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(p.merchant_reference); }}
                          title={copied[p.merchant_reference] ? "Copied!" : "Click to copy"}
                        >
                          {highlightText(p.merchant_reference, qDebounced)}
                          {copied[p.merchant_reference] && (
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
            <tfoot>
              <tr>
                <td colSpan={3} className="muted">Filtered total</td>
                <td>
                  {(() => {
                    const sum = filteredPayments.reduce((acc, p) => acc + (typeof p.amount === "number" ? p.amount : (Number(p.amount) || 0)), 0);
                    return ZAR.format(sum);
                  })()}
                </td>
                <td colSpan={2} className="muted">{filteredPayments.length} {filteredPayments.length === 1 ? "payment" : "payments"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div className="muted">Showing {totalFiltered === 0 ? 0 : (startIndex + 1)}–{Math.min(startIndex + pageSize, totalFiltered)} of {totalFiltered}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(1)} title="First page">« First</button>
            <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} title="Previous page">‹ Prev</button>

            {pageNumbers.map((n) => (
              <button
                key={n}
                className={`btn ${n === currentPage ? '' : 'ghost'}`}
                onClick={() => setPage(n)}
                aria-current={n === currentPage ? 'page' : undefined}
                title={`Go to page ${n}`}
              >
                {n}
              </button>
            ))}

            <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} title="Next page">Next ›</button>
            <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)} title="Last page">Last »</button>

            <div className="muted">Page {currentPage} / {totalPages}</div>
          </div>
        </div>
        <div className="footer">
          Data updates after PayFast IPN; refresh after completing a payment.
        </div>
      </div>

     <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail ? `Payment #${detail.id}` : ""}>
  {detail && (
    <>
      {/* Quick actions */}
      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {detail.pf_payment_id && (
          <button className="btn" onClick={() => copyToClipboard(detail.pf_payment_id)} title="Copy PF Payment ID">
            Copy PF ID
          </button>
        )}
        {detail.merchant_reference && (
          <button className="btn ghost" onClick={() => copyToClipboard(detail.merchant_reference)} title="Copy Merchant Reference">
            Copy Reference
          </button>
        )}
        <button
          className="btn"
          disabled={!detail?.merchant_reference || revalidating}
          onClick={() => revalidatePaymentByRef(detail.merchant_reference)}
          title="Re-run PayFast checks and update this payment"
        >
          {revalidating ? 'Revalidating…' : 'Revalidate'}
        </button>
        <button
          className="btn ghost"
          onClick={() => copyJsonToClipboard(detail)}
          title="Copy this row as JSON"
        >
          Copy row JSON
        </button>
        <a
          className="btn ghost"
          href={`/?q=${encodeURIComponent(detail.pf_payment_id || detail.merchant_reference || '')}`}
          title="Find in table"
        >
          Find in table
        </a>
        <button className="btn ghost" disabled title="Refund (coming soon)">Refund…</button>
        {/* Admin actions (require auth on backend) */}
        <button
          className="btn"
          onClick={() => detail?.id && markPaymentStatus(detail.id, 'PAID')}
          title="Mark this payment as PAID"
        >
          Mark Paid
        </button>
        <button
          className="btn ghost"
          onClick={() => detail?.id && markPaymentStatus(detail.id, 'FAILED')}
          title="Mark this payment as FAILED"
        >
          Mark Failed
        </button>
        <button
          className="btn"
          onClick={() => detail?.id && addNoteToPayment(detail.id)}
          title="Attach an internal note"
        >
          Add note
        </button>
        <button
          className="btn ghost"
          onClick={() => detail?.id && addTagToPayment(detail.id)}
          title="Add a tag to this payment"
        >
          Add tag
        </button>
      </div>

      {/* Details grid */}
      <div className="detail-grid">
        <div>
          <span className="label">PF Payment ID</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{detail.pf_payment_id || "-"}</span>
            {detail.pf_payment_id && (
              <button className="btn ghost" onClick={() => copyToClipboard(detail.pf_payment_id)}>Copy</button>
            )}
          </div>
        </div>
        <div>
          <span className="label">Amount</span>
          <div>{typeof detail.amount === 'number' ? ZAR.format(detail.amount) : (detail.amount ?? '-')}</div>
        </div>
        <div>
          <span className="label">Status</span>
          <div>{renderStatus(detail.status)}</div>
        </div>
        <div>
          <span className="label">Created</span>
          <div>{detail.created_at ? new Date(detail.created_at).toLocaleString() : '-'}</div>
        </div>
        {detail.merchant_reference && (
          <div>
            <span className="label">Reference</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{detail.merchant_reference}</span>
              <button className="btn ghost" onClick={() => copyToClipboard(detail.merchant_reference)}>Copy</button>
            </div>
          </div>
        )}
        {detail.payer_email && (
          <div>
            <span className="label">Payer Email</span>
            <div>{detail.payer_email}</div>
          </div>
        )}
        {detail.payer_name && (
          <div>
            <span className="label">Payer Name</span>
            <div>{detail.payer_name}</div>
          </div>
        )}
        {detail.note && (
          <div>
            <span className="label">Note</span>
            <div style={{ whiteSpace: 'pre-wrap' }}>{detail.note}</div>
          </div>
        )}
        {detail.tags && Array.isArray(detail.tags) && detail.tags.length > 0 && (
          <div>
            <span className="label">Tags</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {detail.tags.map((t, i) => (
                <span key={i} className="badge">{String(t)}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )}
</Drawer>
      <Toasts toasts={toasts} />
    </div>
  );
}