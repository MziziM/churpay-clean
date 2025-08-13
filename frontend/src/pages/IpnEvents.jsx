// frontend/src/pages/IpnEvents.jsx
import React, { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso || ""; }
}

export default function IpnEvents() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState("");

  const q = useMemo(() => {
    const u = new URL(`${API}/api/ipn-events`);
    if (ref.trim()) u.searchParams.set("ref", ref.trim());
    return u.toString();
  }, [API, ref]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(q, { credentials: "include" });
      const j = await r.json();
      setRows(Array.isArray(j) ? j : []);
    } catch (e) {
      console.error("ipn-events fetch failed", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [q]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>IPN Events</h2>
        <span className="badge soft">debug</span>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Filter by reference (m_payment_id / merchant_reference)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button className="btn ghost" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 72 }}>ID</th>
              <th>PF Payment ID</th>
              <th>Ref (m_payment_id)</th>
              <th>Status</th>
              <th>Email</th>
              <th>Created</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 24, color: "#777" }}>
                  No IPN events yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const raw = r.raw || {};
              const refVal = raw.m_payment_id || "";
              const status = (raw.payment_status || "").toUpperCase();
              const email = raw.email_address || raw.payer_email || "";
              const badgeClass =
                status === "COMPLETE" ? "badge success" :
                status === "FAILED"   ? "badge danger"  :
                status === "PENDING"  ? "badge warn"    : "badge soft";
              return (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{r.pf_payment_id || "-"}</td>
                  <td><code>{refVal || "-"}</code></td>
                  <td><span className={badgeClass}>{status || "—"}</span></td>
                  <td>{email || "—"}</td>
                  <td>{formatDate(r.created_at)}</td>
                  <td>
                    {refVal ? (
                      <a className="link" href={`/?ref=${encodeURIComponent(refVal)}`}>
                        View payment
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}