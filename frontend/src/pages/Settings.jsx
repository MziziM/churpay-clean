import { useEffect, useMemo, useState } from "react";

// Compute backend base URL
const BACKEND_URL = (import.meta?.env?.VITE_API_URL?.replace(/\/$/, ""))
  || (typeof window !== "undefined" && window.location.hostname.includes("churpay.com")
      ? "https://api.churpay.com"
      : "http://localhost:5000");

export default function Settings() {
  const [brandColor, setBrandColor] = useState("#6b4fff");
  const [sandboxMode, setSandboxMode] = useState(true);
  const [hex, setHex] = useState("#6b4fff");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Load from backend
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/settings`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.brandColor) setBrandColor(data.brandColor);
        if (typeof data?.sandboxMode === "boolean") setSandboxMode(data.sandboxMode);
        setHex(data?.brandColor || "#6b4fff");
        setLoadError(null);
      } catch (e) {
        console.warn("[Settings] load failed, using defaults", e);
        setLoadError("Couldn’t load settings (using defaults)");
      }
    })();
  }, []);

  // Live apply brand to CSS var
  useEffect(() => {
    try { document.documentElement.style.setProperty("--brand", brandColor); } catch {}
  }, [brandColor]);

  const validHex = useMemo(() => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim()), [hex]);

  async function save() {
    if (!validHex) return;
    setSaving(true);
    try {
      const body = { brandColor: hex.trim(), sandboxMode };
      const res = await fetch(`${BACKEND_URL}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrandColor(hex.trim());
      setSavedAt(new Date());
    } catch (e) {
      alert("Failed to save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetDefault() {
    setHex("#6b4fff");
    setSandboxMode(true);
  }

  return (
    <div className="container" style={{ maxWidth: 820, padding: 16 }}>
      <div className="card" style={{ marginTop: 12 }}>
        <h1 style={{ marginTop: 0 }}>Settings</h1>
        {loadError && <div className="alert warn" style={{ marginBottom: 12 }}>{loadError}</div>}

        {/* Brand Color */}
        <section style={{ marginTop: 12 }}>
          <h3 style={{ margin: 0 }}>Brand color</h3>
          <div className="row" style={{ alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <input
              type="color"
              className="input"
              aria-label="Brand color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              style={{ width: 52, height: 38, padding: 4 }}
            />
            <input
              className="input"
              aria-label="Hex code"
              placeholder="#6b4fff"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') validHex && save(); }}
              style={{ width: 140 }}
            />
            <button className="btn" onClick={save} disabled={!validHex || saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <div className="swatch" style={{ width: 28, height: 28, borderRadius: 6, background: hex, border: '1px solid rgba(0,0,0,.15)' }} title="Preview" />
          </div>
          {!validHex && <div className="alert warn" style={{ marginTop: 8 }}>Enter a valid hex like <code>#6b4fff</code>.</div>}
        </section>

        {/* Sandbox Toggle */}
        <section style={{ marginTop: 18 }}>
          <h3 style={{ margin: 0 }}>Sandbox badge</h3>
          <label className="switch" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={sandboxMode} onChange={(e)=>setSandboxMode(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            <span className="muted">Show SANDBOX badge (recommended in testing)</span>
          </label>
        </section>

        {/* Actions */}
        <section style={{ marginTop: 18 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={resetDefault}>Reset to defaults</button>
            {savedAt && (
              <span className="muted" title={savedAt.toLocaleString()}>
                Saved {Math.max(1, Math.floor((Date.now() - savedAt.getTime())/1000))}s ago
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}