/**
 * OneVue Organization Admin Overview Console
 * Mounted at #/admin/overview
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;
  const { Link } = ReactRouterDOM;

  function AdminOverview() {
    const [session, setSession] = useState(null);
    const [stats, setStats] = useState(null);
    const [activity, setActivity] = useState([]);
    const [performance, setPerformance] = useState(null);
    const [loading, setLoading] = useState(true);
    const [exportingType, setExportingType] = useState(null);

    useEffect(() => {
      const activeSession = window.OV?.services?.admin?.getSession();
      setSession(activeSession);

      Promise.all([
        window.OV.services.admin.getUserStats().catch(() => ({ metrics: null })),
        window.OV.services.admin.getActivityTimeline(14).catch(() => ({ timeline: [] })),
        window.OV.services.admin.getPerformanceMetrics().catch(() => ({ performance: null })),
      ]).then(([statsRes, actRes, perfRes]) => {
        setStats(statsRes.metrics || null);
        setActivity(actRes.timeline || []);
        setPerformance(perfRes.performance || null);
        setLoading(false);
      });
    }, []);

    const handleDownloadReport = async (type) => {
      setExportingType(type);
      try {
        await window.OV.services.admin.downloadReport(type);
      } catch (err) {
        alert(err.message);
      } finally {
        setExportingType(null);
      }
    };

    const { user } = session || { user: {} };

    return (
      <window.AdminLayout activeTab="overview">
        {/* Welcome Header */}
        <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}>
                {user.role}
              </span>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>
                OneVue Organization Governance
              </span>
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 6px', color: '#fff' }}>
              Welcome, {user.name}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Real-time system health, disciplinary oversight, and GDPR compliance governance.
            </p>
          </div>

          {/* Quick CSV Export Bar */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              disabled={!!exportingType}
              onClick={() => handleDownloadReport('users')}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#f8fafc',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📥 {exportingType === 'users' ? 'Exporting...' : 'Export Users CSV'}
            </button>
            <button
              disabled={!!exportingType}
              onClick={() => handleDownloadReport('audit_logs')}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#f8fafc',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📜 {exportingType === 'audit_logs' ? 'Exporting...' : 'Export Audit CSV'}
            </button>
          </div>
        </div>

        {/* Live System Stat Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Total Users</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {loading ? '...' : stats?.total_users || 0}
            </div>
            <div style={{ fontSize: 12, color: '#34d399', marginTop: 4 }}>
              {stats?.active_users || 0} Active accounts
            </div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Blocked / Suspended</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#f87171', marginTop: 4 }}>
              {loading ? '...' : (stats?.blocked_users || 0) + (stats?.suspended_users || 0)}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {stats?.deleted_users || 0} GDPR scrubbed
            </div>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Pending Appeals</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#fbbf24', marginTop: 4 }}>
              {loading ? '...' : stats?.pending_appeals || 0}
            </div>
            <Link to="/admin/appeals" style={{ fontSize: 12, color: '#818cf8', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>
              Review appeals queue →
            </Link>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Compliance Requests</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#a78bfa', marginTop: 4 }}>
              {loading ? '...' : stats?.pending_compliance_requests || 0}
            </div>
            <Link to="/admin/compliance" style={{ fontSize: 12, color: '#818cf8', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>
              Manage GDPR requests →
            </Link>
          </div>

          <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>Active Admin Sessions</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#38bdf8', marginTop: 4 }}>
              {loading ? '...' : stats?.active_admin_sessions || 1}
            </div>
            <Link to="/admin/sessions" style={{ fontSize: 12, color: '#818cf8', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>
              Inspect sessions →
            </Link>
          </div>
        </div>

        {/* Activity Timeline Bar Chart */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          padding: '24px',
          marginBottom: 32,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px', color: '#fff' }}>
                Operational Activity Timeline (Last 14 Days)
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
                Daily administrative actions, registrations, and account status modifications.
              </p>
            </div>
            <span style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>
              ● Live Telemetry
            </span>
          </div>

          {activity.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No activity in the selected window.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 20 }}>
              {activity.map((day) => {
                const totalActions = day.adminActions + day.registrations + day.blocks;
                const heightPercent = Math.min(100, Math.max(12, (totalActions / 40) * 100));
                return (
                  <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                    <div
                      title={`${day.date}: ${day.adminActions} admin actions, ${day.registrations} signups, ${day.blocks} blocks`}
                      style={{
                        width: '100%',
                        maxWidth: 28,
                        height: `${heightPercent}%`,
                        background: day.blocks > 0 ? 'linear-gradient(180deg, #f87171, #ef4444)' : 'linear-gradient(180deg, #818cf8, #6366f1)',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.3s ease',
                      }}
                    />
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, whiteSpace: 'nowrap' }}>
                      {day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Security Ratios & Quick Links */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
        }}>
          {/* Performance & Login Security */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: 24,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#fff' }}>
              Security & Login Metrics (30d)
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Admin Login Success Rate</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#34d399' }}>
                {performance?.login_metrics?.success_rate_percent || 100}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Total Recorded Audit Events</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                {performance?.total_audit_events || 0}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Published Visiting Cards</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#818cf8' }}>
                {stats?.total_visiting_cards || 0}
              </span>
            </div>
            <Link to="/admin/logs" style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
              View Complete Audit Logs Stream →
            </Link>
          </div>

          {/* Quick Domain Matrix */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: 24,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#fff' }}>
              Platform Governance Shortcuts
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Link to="/admin/users" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#f1f5f9', textDecoration: 'none', fontSize: 13 }}>
                <span>👥 User Safeguards & Impact Previews</span>
                <span style={{ color: '#818cf8' }}>Open →</span>
              </Link>
              <Link to="/admin/appeals" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#f1f5f9', textDecoration: 'none', fontSize: 13 }}>
                <span>⚖️ Ban Appeals Queue</span>
                <span style={{ color: '#818cf8' }}>Open →</span>
              </Link>
              <Link to="/admin/compliance" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#f1f5f9', textDecoration: 'none', fontSize: 13 }}>
                <span>🛡️ GDPR Right-of-Access & Erasure</span>
                <span style={{ color: '#818cf8' }}>Open →</span>
              </Link>
              <Link to="/admin/domains" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#f1f5f9', textDecoration: 'none', fontSize: 13 }}>
                <span>🌐 Domain Registry & RBAC Matrix</span>
                <span style={{ color: '#818cf8' }}>Open →</span>
              </Link>
            </div>
          </div>
        </div>
      </window.AdminLayout>
    );
  }

  window.AdminOverview = AdminOverview;
})();
