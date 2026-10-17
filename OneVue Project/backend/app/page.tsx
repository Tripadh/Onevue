export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
      <div style={{ maxWidth: 540, width: "100%", background: "#14161f", border: "1px solid #232738", borderRadius: 20, padding: "36px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999, background: "#1b253b", color: "#60a5fa", fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
          OneVue Backend Services
        </div>
        <h1 style={{ fontSize: 26, margin: "0 0 10px", fontWeight: 700 }}>OneVue API is Running</h1>
        <p style={{ color: "#94a3b8", fontSize: 14.5, lineHeight: 1.6, margin: "0 0 24px" }}>
          This server hosts the Next.js API authentication routes and role-based dashboard endpoints. The frontend user interface runs via the frontend static server.
        </p>

        <div style={{ display: "grid", gap: 12, marginBottom: 28 }}>
          <div style={{ padding: "12px 16px", borderRadius: 12, background: "#0c0d12", border: "1px solid #1e2230", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Frontend Web App:</span>{" "}
            <a href="http://localhost:8080" style={{ color: "#38bdf8", textDecoration: "none", fontWeight: 600 }}>http://localhost:8080 →</a>
          </div>
          <div style={{ padding: "12px 16px", borderRadius: 12, background: "#0c0d12", border: "1px solid #1e2230", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Auth Endpoints:</span>{" "}
            <span style={{ color: "#e2e8f0", fontFamily: "monospace" }}>/api/auth/login</span>, <span style={{ color: "#e2e8f0", fontFamily: "monospace" }}>/api/auth/register</span>
          </div>
          <div style={{ padding: "12px 16px", borderRadius: 12, background: "#0c0d12", border: "1px solid #1e2230", fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Dashboard Endpoints:</span>{" "}
            <span style={{ color: "#e2e8f0", fontFamily: "monospace" }}>/api/dashboard/[role]</span>
          </div>
        </div>

        <a
          href="http://localhost:8080"
          style={{
            display: "block",
            textAlign: "center",
            padding: "14px 20px",
            background: "#2563eb",
            color: "#ffffff",
            borderRadius: 999,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Open Frontend Application (localhost:8080)
        </a>
      </div>
    </main>
  );
}
