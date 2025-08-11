// frontend/src/pages/Settings.jsx
import { useEffect, useState } from "react";
import { isAuthed } from "../auth";

const BRAND_KEY = "churpay_brand";            // CSS color for --brand
const HIDE_SANDBOX_KEY = "churpay_hide_sandbox"; // boolean "true"/"false"

const PRESETS = [
  { name: "Blue (Default)", value: "#2563eb" },
  { name: "Purple", value: "#6d28d9" },
  { name: "Teal", value: "#0ea5a4" },
  { name: "Green", value: "#16a34a" },
  { name: "Crimson", value: "#dc2626" },
];

export default function Settings() {
  if (!isAuthed()) {
    window.location.href = "/login";
    return null;
  }

  const [brand, setBrand] = useState(localStorage.getItem(BRAND_KEY) || "");
  const [hideSandbox, setHideSandbox] = useState(localStorage.getItem(HIDE_SANDBOX_KEY) === "true");

  useEffect(() => {
    // Apply brand color live
    if (brand) {
      document.documentElement.style.setProperty("--brand", brand);
      // derive a darker hover shade (very rough)
      try {
        const shade = darken(brand, 0.12);
        document.documentElement.style.setProperty("--brand-600", shade);
      } catch {}
    }
  }, [brand]);

  const save = () => {
    localStorage.setItem(BRAND_KEY, brand || "");
    localStorage.setItem(HIDE_SANDBOX_KEY, hideSandbox ? "true" : "false");
    alert("Settings saved. Refresh the page to ensure all components pick up changes.");
  };

  const reset = () => {
    localStorage.removeItem(BRAND_KEY);
    localStorage.removeItem(HIDE_SANDBOX_KEY);
    alert("Settings reset. Refresh the page.");
  };

  return (
    <div className="container">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.svg" alt="ChurPay logo" className="logo"
            onError={(e)=>{ if(e.currentTarget.src.endsWith("logo.svg")) e.currentTarget.src="/logo.png"; }}/>
          <div className="brand"><span>Chur</span><span className="pay">Pay</span></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href="/admin">Back to Admin</a>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Settings</h1>

        <div className="row" style={{ alignItems: "center" }}>
          <div className="col">
            <label className="label">Brand color</label>
            <input
              className="input"
              type="text"
              placeholder="#2563eb"
              value={brand}
              onChange={(e)=>setBrand(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {PRESETS.map(p => (
                <button key={p.value} className="btn ghost" onClick={()=>setBrand(p.value)}>{p.name}</button>
              ))}
              <input type="color" value={brand || "#2563eb"} onChange={(e)=>setBrand(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label className="label">
            <input
              type="checkbox"
              checked={hideSandbox}
              onChange={(e)=>setHideSandbox(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Hide “Sandbox” badge on header
          </label>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn" onClick={reset}>Reset</button>
        </div>
      </div>
    </div>
  );
}

// quick hex darken
function darken(hex, amount = 0.12) {
  const c = hex.replace("#","").trim();
  const n = parseInt(c, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.floor(r * (1 - amount)));
  g = Math.max(0, Math.floor(g * (1 - amount)));
  b = Math.max(0, Math.floor(b * (1 - amount)));
  const toHex = (x) => x.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}