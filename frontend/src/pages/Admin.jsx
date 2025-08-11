// frontend/src/pages/Admin.jsx
import { isAuthed, logout } from "../auth";

export default function Admin() {
  if (!isAuthed()) {
    window.location.href = "/login";
    return null;
  }

  return (
    <div className="container">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.svg" alt="ChurPay logo" className="logo"
            onError={(e)=>{ if(e.currentTarget.src.endsWith("logo.svg")) e.currentTarget.src="/logo.png"; }}/>
          <div className="brand"><span>Chur</span><span className="pay">Pay</span></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn ghost" href="/settings">Settings</a>
          <button className="btn" onClick={() => { logout(); window.location.href = "/"; }}>
            Log out
          </button>
        </div>
      </div>

      <div className="card">
        <h1 style={{ marginTop: 0 }}>Admin Dashboard</h1>
        <p className="muted">Private tools for your team.</p>

        <div className="grid" style={{ marginTop: 12 }}>
          <div className="card">
            <h3>Settings</h3>
            <p className="muted">Brand colors, Sandbox badge toggle, and more.</p>
            <a href="/settings" className="btn btn-primary">Open Settings</a>
          </div>

          <div className="card">
            <h3>Payments</h3>
            <p className="muted">View and filter recent transactions on the main dashboard.</p>
            <a href="/" className="btn">Go to Dashboard</a>
          </div>
        </div>
      </div>
    </div>
  );
}