// frontend/src/pages/Login.jsx
import { useState } from "react";
import { login, isAuthed } from "../auth";

export default function Login() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setErr("");
    if (login(pass)) {
      // go to admin
      window.location.href = "/admin";
    } else {
      setErr("Incorrect password.");
    }
  };

  if (isAuthed()) {
    // already logged in — go straight to admin
    window.location.href = "/admin";
    return null;
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
        <div className="topbar" style={{ position: "static", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/logo.svg" alt="ChurPay logo" className="logo"
              onError={(e)=>{ if(e.currentTarget.src.endsWith("logo.svg")) e.currentTarget.src="/logo.png"; }}/>
            <div className="brand"><span>Chur</span><span className="pay">Pay</span></div>
          </div>
          <span className="badge">Admin</span>
        </div>

        <h1 style={{ marginTop: 0 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 6 }}>Enter admin password to continue.</p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="label" htmlFor="adminPass">Password</label>
          <input
            id="adminPass"
            className="input"
            type="password"
            placeholder="••••••••"
            value={pass}
            onChange={(e)=>setPass(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Sign in</button>
          {err && <div className="alert err">{err}</div>}
        </form>

        <div style={{ marginTop: 12 }}>
          <a className="btn" href="/">Back to Home</a>
        </div>
      </div>
    </div>
  );
}
