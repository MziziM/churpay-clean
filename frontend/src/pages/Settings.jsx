import { useEffect, useMemo, useState } from "react";
import "../App.css";

const HIDE_SANDBOX_KEY = "churpay_hide_sandbox";
const BRAND_KEY = "churpay_brand";
const PAGE_SIZE_KEY = "churpay_default_page_size";

export default function Settings() {
  const [brand, setBrand] = useState("");
  const [brandText, setBrandText] = useState("");
  const [hideSandbox, setHideSandbox] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [notice, setNotice] = useState("");

  // Load saved prefs
  useEffect(() => {
    try {
      const b = localStorage.getItem(BRAND_KEY) || "";
      const h = localStorage.getItem(HIDE_SANDBOX_KEY) === "true";
      const ps = Number(localStorage.getItem(PAGE_SIZE_KEY) || "10") || 10;
      setBrand(b);
      setBrandText(b);
      setHideSandbox(h);
      setPageSize(ps);
      if (b) document.documentElement.style.setProperty("--brand", b); // live preview
    } catch {}
  }, []);

  // Keep text field and color in sync when hex is valid
  useEffect(() => {
    if (/^#([0-9a-f]{3}){1,2}$/i.test(brandText)) setBrand(brandText);
  }, [brandText]);

  // Live preview brand when color changes
  useEffect(() => {
    if (brand) document.documentElement.style.setProperty("--brand", brand);
  }, [brand]);

  const save = () => {
    try {
      if (brand) localStorage.setItem(BRAND_KEY, brand);
      else localStorage.removeItem(BRAND_KEY);

      localStorage.setItem(HIDE_SANDBOX_KEY, hideSandbox ? "true" : "false");
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));

      setNotice("Settings saved. Reloading…");
      setTimeout(() => { window.location.href = "/?v=" + Date.now(); }, 600);
    } catch {
      setNotice("Could not save settings. Check browser privacy settings.");
    }
  };

  const resetDefaults = () => {
    try {
      localStorage.removeItem(BRAND_KEY);
      localStorage.removeItem(HIDE_SANDBOX_KEY);
      localStorage.removeItem(PAGE_SIZE_KEY);
      setNotice("Settings reset. Reloading…");
      setTimeout(() => { window.location.href = "/?v=" + Date.now(); }, 600);
    } catch {}
  };

  const brandPreview = useMemo(() => ({
    width: 20, height: 20, borderRadius: 4,
    border: '1px solid var(--border)',
    background: brand || 'var(--brand)',
  }), [brand]);

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <div className="muted" style={{ marginTop: 6 }}>
          These settings are stored in your browser and apply instantly.
        </div>
        {notice && <div className="alert ok" style={{ marginTop: 8 }}>{notice}</div>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <section>
          <h2 style={{ marginTop: 0 }}>Brand</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={brandPreview} title="Preview" />
            <input
              type="color"
              value={/^#([0-9a-f]{3}){1,2}$/i.test(brand) ? brand : '#6d28d9'}
              onChange={(e)=>{ setBrand(e.target.value); setBrandText(e.target.value); }}
              aria-label="Brand color"
            />
            <input
              className="input"
              placeholder="#6d28d9"
              value={brandText}
              onChange={(e)=>setBrandText(e.target.value)}
              style={{ width: 120 }}
              aria-label="Brand color hex"
            />
            <button className="btn ghost" onClick={()=>{ setBrand('#6d28d9'); setBrandText('#6d28d9'); }}>
              Use default
            </button>
          </div>
        </section>

        <section>
          <h2 style={{ marginTop: 0 }}>Display</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={hideSandbox}
              onChange={(e)=>setHideSandbox(e.target.checked)}
            />
            Hide Sandbox badge in header
          </label>
        </section>

        <section>
          <h2 style={{ marginTop: 0 }}>Table defaults</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="label" htmlFor="pageSize">Rows per page</label>
            <select
              id="pageSize"
              className="input"
              value={pageSize}
              onChange={(e)=>setPageSize(Number(e.target.value)||10)}
              style={{ width: 120 }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={save}>Save</button>
          <button className="btn ghost" onClick={resetDefaults}>Reset defaults</button>
          <a className="btn ghost" href="/">Back</a>
        </div>
      </div>
    </div>
  );
}