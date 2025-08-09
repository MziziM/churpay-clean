import { useState } from "react";

function Badge({ children }) {
  return (
    <span className="badge">{children}</span>
  );
}

function Card({ title, right, children }) {
  return (
    <div className="card" style={{ padding: 18, borderRadius: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function KPI({ label, value, help }) {
  return (
    <div className="kpi">
      <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
      <div className="value">{value}</div>
      {help && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>{help}</div>}
    </div>
  );
}

const slides = [
  {
    key: "overview",
    title: "Overview",
    content: (
      <>
        <div className="card" style={{ padding: 24, borderRadius: 20, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#60a5fa,#22c55e)" }} />
                <strong>Churpay</strong>
                <Badge>Sandbox MVP</Badge>
              </div>
              <h2 style={{ margin: "4px 0 8px" }}>Seamless payments made simple.</h2>
              <p style={{ maxWidth: 700, margin: 0, color: "#475569" }}>
                Fast, secure online payments built for churches & non-profits. Powered by PayFast with real-time IPN updates.
              </p>
              <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 14, padding: 0, listStyle: "none" }}>
                {["PayFast checkout", "IPN persistence", "Investor-ready UI"].map((t, i) => (
                  <li key={i} className="point">{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <div className="card"><h4>Frontend</h4><div style={{ color:"#475569" }}>Vite + React<br/>Env: <code>VITE_API_URL</code><br/>Domain: <code>www.churpay.com</code></div></div>
          <div className="card"><h4>Backend</h4><div style={{ color:"#475569" }}>Express + IPN<br/>CORS + rate-limit + HTTPS<br/>Domain: <code>api.churpay.com</code></div></div>
          <div className="card"><h4>Database</h4><div style={{ color:"#475569" }}>Postgres (Render)<br/>Table: <code>payments</code><br/>Insert on IPN, list via API</div></div>
        </div>
      </>
    )
  },
  {
    key: "dashboard",
    title: "Dashboard UI",
    content: (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 12 }}>
          <KPI label="Total processed" value="R 0,00" help="Sandbox demo" />
          <KPI label="Payments" value="0" />
          <KPI label="API health" value="OK" />
        </div>
        <Card title="Recent Payments" right={<button className="btn">Refresh</button>}>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>ID</th><th>PF Payment ID</th><th>Amount</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>—</td><td>—</td><td><strong>R 50,00</strong></td><td><Badge>Pending</Badge></td><td>—</td>
                </tr>
                <tr>
                  <td>—</td><td>—</td><td><strong>R 10,00</strong></td><td><Badge>Complete</Badge></td><td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </>
    )
  },
  {
    key: "checkout",
    title: "Checkout Flow",
    content: (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
        <Card title="Initiate Payment">
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder="Amount (ZAR)" defaultValue="50.00" />
            <button className="btn">PayFast (Sandbox)</button>
          </div>
          <div style={{ color:"#64748b", fontSize: 12, marginTop: 8 }}>Backend: <code>/api/payfast/initiate</code> → redirect to PayFast</div>
        </Card>
        <Card title="Return / Cancel">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="card" style={{ background:"#ecfdf5", borderColor:"#bbf7d0" }}>
              <div style={{ color:"#065f46", fontWeight:600 }}>Return (Success)</div>
              <div style={{ color:"#475569", fontSize:12, marginTop:4 }}>Thank you screen + Back to dashboard.</div>
            </div>
            <div className="card" style={{ background:"#fef2f2", borderColor:"#fecaca" }}>
              <div style={{ color:"#7f1d1d", fontWeight:600 }}>Cancel</div>
              <div style={{ color:"#475569", fontSize:12, marginTop:4 }}>No charge; easy retry link.</div>
            </div>
          </div>
        </Card>
      </div>
    )
  },
  {
    key: "plan",
    title: "Plan & Milestones",
    content: (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
        <Card title="Phase 1 — Investor-ready (Today)" right={<Badge>In Progress</Badge>}>
          <ul style={{ margin:0, paddingLeft:18 }}>
            <li>Sandbox checkout + return/cancel ✅</li>
            <li>Health check + dashboard ✅</li>
            <li>Persist payments (Postgres) ☐</li>
            <li>Rate-limit + HTTPS redirect ☐</li>
            <li>Polished copy + footer ☐</li>
          </ul>
        </Card>
        <Card title="Phase 2 — Domains & SSL" right={<Badge>Pending</Badge>}>
          <ul style={{ margin:0, paddingLeft:18 }}>
            <li>API cert: <code>api.churpay.com</code> ☐</li>
            <li>Flip envs to custom domains ☐</li>
            <li>Final CORS tighten ☐</li>
          </ul>
        </Card>
        <Card title="Phase 3 — Go-Live" right={<Badge>Queued</Badge>}>
          <ul style={{ margin:0, paddingLeft:18 }}>
            <li>PAYFAST_MODE=live ☐</li>
            <li>Live merchant creds ☐</li>
            <li>R10 test payment ☐</li>
          </ul>
        </Card>
      </div>
    )
  }
];

export default function Deck() {
  const [i, setI] = useState(0);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: "linear-gradient(135deg,#60a5fa,#22c55e)" }} />
          <div>
            <div style={{ fontWeight: 700 }}>Churpay</div>
            <div style={{ color:"#64748b", fontSize: 12 }}>PayFast for Churches — Presentation</div>
          </div>
        </div>
        <Badge>Live Demo</Badge>
      </header>

      <nav className="deck-nav" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {slides.map((s, idx) => (
          <button
            key={s.key}
            onClick={() => setI(idx)}
            className={`btn ${i===idx ? "" : ""}`}
            style={{
              background: i===idx ? "#0f172a" : "#fff",
              color: i===idx ? "#fff" : "#0f172a",
              border: "1px solid #e2e8f0",
              padding: "8px 12px",
              borderRadius: 999,
              fontSize: 13
            }}
          >
            {idx+1}. {s.title}
          </button>
        ))}
      </nav>

      <div className="card" style={{ padding: 16, borderRadius: 20 }}>
        {slides[i].content}
      </div>

      <footer style={{ color:"#64748b", fontSize: 12, marginTop: 12 }}>
        © {new Date().getFullYear()} Churpay. Sandbox demo for internal review. UI is representative; actual data appears after IPN persists to Postgres.
      </footer>
    </div>
  );
}