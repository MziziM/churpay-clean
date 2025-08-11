import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";
import Deck from "./Deck.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";
import Settings from "./pages/Settings.jsx";
import { isAuthed } from "./auth.js";

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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All"); // All | Paid | Pending | Failed
  const [dateRange, setDateRange] = useState("All");       // All | Today | 7d | 30d
  const [fromDate, setFromDate] = useState(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState("");   // YYYY-MM-DD
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState(null); // selected payment for detail modal
  const [usedLocalFallback, setUsedLocalFallback] = useState(false);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState(null); // string | null
  const [sortBy, setSortBy] = useState("created_at"); // id | pf_payment_id | amount | status | created_at
  const [sortDir, setSortDir] = useState("desc");      // asc | desc
  const [compact, setCompact] = useState(() => {
    try { return localStorage.getItem('churpay_compact') === 'true'; } catch { return false; }
  });
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
    const pickRows = (j) => (Array.isArray(j) ? j : j?.rows || []);
    try {
      setLoadingPayments(true);
      setUsedLocalFallback(false);
      setCacheUpdatedAt(null);

      // Try live API first
      const r = await fetch(`${apiBase}/api/payments`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await safeJson(r);
      const rows = pickRows(j);
      rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setPayments(rows);
      setLastRefreshAt(Date.now());
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
        pushToast("warn", `Loaded ${rows2.length} from local cache.`, "Offline mode");
      } catch (e2) {
        pushToast("err", "Could not load payments (API & local cache failed).");
      }
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

    // Text query
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter((p) => {
        const idStr = String(p.id ?? "");
        const pfid = String(p.pf_payment_id ?? "");
        const amt = typeof p.amount === "number" ? String(p.amount) : String(p.amount ?? "");
        const s = String(p.status ?? "").toLowerCase();
        return (
          idStr.toLowerCase().includes(q) ||
          pfid.toLowerCase().includes(q) ||
          amt.toLowerCase().includes(q) ||
          s.includes(q)
        );
      });
    }

    return sortRows(result, sortBy, sortDir);
  }, [payments, query, statusFilter, dateRange, fromDate, toDate, sortBy, sortDir]);

  const totalFiltered = filteredPayments.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pagedPayments = filteredPayments.slice(startIndex, startIndex + pageSize);

  useEffect(() => { setPage(1); }, [query, statusFilter, dateRange, pageSize, fromDate, toDate]);

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

  const exportCSV = () => {
    const headers = ["id", "pf_payment_id", "amount", "status", "created_at"];
    const escape = (v) => `"${String(v ?? "").replace(/\"/g, '""')}"`;
    const lines = [headers.join(",")].concat(
      filteredPayments.map((p) =>
        [
          p.id,
          p.pf_payment_id,
          typeof p.amount === "number" ? p.amount.toFixed(2) : p.amount,
          p.status,
          p.created_at,
        ]
          .map(escape)
          .join(",")
      )
    );
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const exportJSON = () => {
    const payload = {
      meta: {
        exported_at: new Date().toISOString(),
        filtered_count: filteredPayments.length,
      },
      rows: filteredPayments,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  // --- Route handling (after hooks to satisfy rules-of-hooks) ---
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  // read Settings preferences (brand + hide sandbox) saved in localStorage
const HIDE_SANDBOX_KEY = "churpay_hide_sandbox";
const BRAND_KEY = "churpay_brand";
const hideSandboxPref = localStorage.getItem(HIDE_SANDBOX_KEY) === "true";
const savedBrand = localStorage.getItem(BRAND_KEY);
// apply brand live if saved
useEffect(() => {
  if (savedBrand) {
    document.documentElement.style.setProperty("--brand", savedBrand);
  }
}, [savedBrand]);

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

function Modal({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{title || "Details"}</h3>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
if (path === "/admin") {
  return <Admin />;
}
if (path === "/settings") {
  // protect settings
  return isAuthed() ? <Settings /> : (window.location.href = "/login", null);
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
        {APP_ENV !== "production" && !hideSandboxPref && <span className="badge">Sandbox</span>}
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
            placeholder="Search by ID, PF ID, amount, or status…"
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["All", "Paid", "Pending", "Failed"]).map((label) => (
              <button
                key={label}
                type="button"
                className={`btn ghost ${statusFilter === label ? 'active' : ''}`}
                onClick={() => setStatusFilter(label)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["All", "Today", "7d", "30d"]).map((r) => (
              <button
                key={r}
                type="button"
                className={`btn ghost ${dateRange === r ? 'active' : ''}`}
                onClick={() => { setDateRange(r); setFromDate(""); setToDate(""); }}
              >
                {r}
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                className="input"
                value={fromDate}
                onChange={(e)=>{ setFromDate(e.target.value); setDateRange("All"); }}
                aria-label="From date"
                style={{ width: 160 }}
              />
              <span className="muted">to</span>
              <input
                type="date"
                className="input"
                value={toDate}
                onChange={(e)=>{ setToDate(e.target.value); setDateRange("All"); }}
                aria-label="To date"
                style={{ width: 160 }}
              />
              {(fromDate || toDate) && (
                <button type="button" className="btn ghost" onClick={()=>{ setFromDate(""); setToDate(""); }}>Clear dates</button>
              )}
            </div>
            <button type="button" className="btn ghost" onClick={exportCSV} title="Download filtered as CSV">Export CSV</button>
            <button type="button" className="btn ghost" onClick={exportJSON} title="Download filtered as JSON">Export JSON</button>
            <button type="button" className="btn" onClick={resetFilters} title="Clear search, filters and dates">Reset filters</button>
            <select
              className="input"
              style={{ width: 120 }}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value) || 10); }}
              aria-label="Rows per page"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
            </select>
            <label className="switch" title="Compact rows">
              <input type="checkbox" checked={compact} onChange={(e)=>setCompact(e.target.checked)} />
              <span className="track"><span className="thumb" /></span>
              <span className="muted">Compact</span>
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder="Preset name…"
                value={presetName}
                onChange={(e)=>setPresetName(e.target.value)}
                style={{ width: 160 }}
              />
              <button type="button" className="btn" onClick={savePreset}>Save preset</button>
              <select
                className="input"
                style={{ width: 180 }}
                onChange={(e)=>{
                  const name = e.target.value; if (!name) return;
                  const p = presets.find(x => x.name === name);
                  applyPreset(p);
                  // reset dropdown back to placeholder so user can re-apply same preset later if desired
                  e.target.selectedIndex = 0;
                }}
              >
                <option value="">Load preset…</option>
                {presets.sort((a,b)=>a.name.localeCompare(b.name)).map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn ghost"
                onClick={()=>{
                  const name = prompt('Delete which preset? Enter the exact name:');
                  if (name) deletePreset(name);
                }}
                title="Delete a saved preset by name"
              >
                Delete preset
              </button>
            </div>
          </div>
        </div>
        <div className="tableWrap" style={{ marginTop: 8 }}>
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
                  <td colSpan={5} className="empty" style={{ textAlign: 'left' }}>
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
                  <td colSpan={5} className="empty">
                    No payments match your filters.
                  </td>
                </tr>
              ) : (
                pagedPayments.map((p) => (
                  <tr key={p.id} className="row-click" onClick={(e) => {
                    const tag = (e.target.tagName || '').toLowerCase();
                    if (tag === 'button' || tag === 'a' || tag === 'input') return; // let buttons/links work
                    setDetail(p);
                  }}>
                    <td data-label="ID">{p.id}</td>
                    <td data-label="PF Payment ID">
                      {p.pf_payment_id ? (
                        <span
                          className="copy-id"
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(p.pf_payment_id); }}
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
            <tfoot>
              <tr>
                <td colSpan={2} className="muted">Filtered total</td>
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(1)}>« First</button>
            <button className="btn" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ Prev</button>
            <div className="muted">Page {currentPage} / {totalPages}</div>
            <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next ›</button>
            <button className="btn" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>Last »</button>
          </div>
        </div>
        <div className="footer">
          Data updates after PayFast IPN; refresh after completing a payment.
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Payment #${detail.id}` : ""}>
        {detail && (
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
          </div>
        )}
      </Modal>
      <Toasts toasts={toasts} />
    </div>
  );
}