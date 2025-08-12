import { useEffect, useMemo, useState } from "react";

// Shared keys with App.jsx
const HIDE_SANDBOX_KEY = "churpay_hide_sandbox";
const BRAND_KEY = "churpay_brand";

export default function Settings() {
  const [brand, setBrand] = useState(() => {
    try { return localStorage.getItem(BRAND_KEY) || "#6b4fff"; } catch { return "#6b4fff"; }
  });
  const [hideSandbox, setHideSandbox] = useState(() => {
    try { return localStorage.getItem(HIDE_SANDBOX_KEY) === "true"; } catch { return false; }
  });
  const [hex, setHex] = useState(brand);
  const [savedAt, setSavedAt] = useState(null);

  // live preview brand
  useEffect(() => {
    try { document.documentElement.style.setProperty("--brand", brand); } catch {}
    setHex(brand);
  }, [brand]);

  // persist (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(BRAND_KEY, brand);
        localStorage.setItem(HIDE_SANDBOX_KEY, hideSandbox ? "true" : "false");
        setSavedAt(new Date());
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [brand, hideSandbox]);

  const validHex = useMemo(
    () => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim()),
    [hex]
  );

  const applyHex = () => {
    if (!validHex) return;
    setBrand(hex.trim());
  };

  const resetDefault = () => {
    setBrand("#6b4fff");
    setHideSandbox(false);
  };

  const clearAll = () => {
    try {
      localStorage.removeItem(BRAND_KEY);
      localStorage.removeItem(HIDE_SANDBOX_KEY);
    } catch {}
    setBrand("#6b4fff");
    setHideSandbox(false);
  };

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="card" style={{ marginTop: 12 }}>
        <h1 style={{ marginTop: 0 }}>Settings</h1>
        <p className="muted" style={{ marginTop: -6 }}>
          Personalize ChurPay for your team. Changes are saved locally in your browser.
        </p>

        {/* Brand Color */}
        <section style={{ marginTop: 18 }}>
          <h3 style={{ margin: 0 }}>Brand color</h3>
          <div className="row" style={{ alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <input
              type="color"
              className="input"
              aria-label="Brand color"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              style={{ width: 52, height: 38, padding: 4 }}
            />
            <input
              className="input"
              aria-label="Hex code"
              placeholder="#6b4fff"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={applyHex}
              onKeyDown={(e) => { if (e.key === "Enter") applyHex(); }}
              style={{ width: 140 }}
            />
            <button className="btn" onClick={applyHex} disabled={!validHex}>
              Apply
            </button>
            <div
              className="swatch"
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: brand,
                border: "1px solid rgba(0,0,0,.15)"
              }}
              title="Live preview"
            />
          </div>
          {!validHex && (
            <div className="alert warn" style={{ marginTop: 8 }}>
              Enter a valid hex color like <code>#6b4fff</code>.
            </div>
          )}
        </section>

        {/* Sandbox Badge Toggle */}
        <section style={{ marginTop: 18 }}>
          <h3 style={{ margin: 0 }}>Sandbox badge</h3>
          <label className="switch" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={hideSandbox}
              onChange={(e) => setHideSandbox(e.target.checked)}
            />
            <span className="track"><span className="thumb" /></span>
            <span className="muted">Hide Sandbox badge when not in production</span>
          </label>
        </section>

        {/* Actions */}
        <section style={{ marginTop: 18 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={resetDefault}>Reset to defaults</button>
            <button className="btn" onClick={clearAll}>Clear saved settings</button>
            {savedAt && (
              <span className="muted" title={savedAt.toLocaleString()}>
                Saved {Math.max(1, Math.floor((Date.now() - savedAt.getTime()) / 1000))}s ago
              </span>
            )}
          </div>
        </section>
      </div>

      {/* Tips */}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Tips</h3>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>The brand color updates primary buttons, accents, and the topbar hairline.</li>
          <li>The Sandbox badge is only visible when <code>VITE_ENV</code> isn’t <code>production</code>.</li>
          <li>Settings are stored per-browser. Teammates can pick their own preview colors.</li>
        </ul>
      </div>
    </div>
  );
}