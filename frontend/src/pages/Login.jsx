// frontend/src/pages/Login.jsx
import { useEffect, useState } from "react";
import "../App.css";

export default function Login() {
  const [email, setEmail] = useState("admin@churpay.com");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const apiBase = (import.meta.env.VITE_API_URL || "").trim() || "";

  // Show a message if redirected from a protected page
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reason") === "auth") {
        setNotice("Please log in to access Admin.");
      }
    } catch {}
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || `Login failed (HTTP ${r.status})`);
      }
      // success → go to admin
      window.location.href = "/admin";
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
        <div className="topbar" style={{ position: "static", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="/logo.svg"
              alt="ChurPay logo"
              className="logo"
              onError={(e) => { if (e.currentTarget.src.endsWith("logo.svg")) e.currentTarget.src = "/logo.png"; }}
            />
            <div className="brand"><span>Chur</span><span className="pay">Pay</span></div>
          </div>
          <span className="badge">Admin</span>
        </div>

        <h1 style={{ marginTop: 0 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 6 }}>Use your admin email and password.</p>
        {notice && <div className="alert warn" style={{ marginTop: 8 }}>{notice}</div>}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            placeholder="you@churpay.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />

          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <button className="btn btn-primary" type="submit" disabled={loading} aria-busy={loading ? 'true' : 'false'}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          {err && <div className="alert err">{err}</div>}
        </form>

        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <a className="btn" href="/">Back to Home</a>
        </div>
      </div>
    </div>
  );
}
