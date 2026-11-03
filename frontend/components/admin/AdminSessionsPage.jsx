/**
 * OneVue Admin Active Sessions & Security Governance Page
 * Mounted at #/admin/sessions
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminSessionsPage() {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [toastMsg, setToastMsg] = useState(null);
    const [revokingId, setRevokingId] = useState(null);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const fetchSessions = async () => {
      setLoading(true);
      try {
        const res = await window.OV.services.admin.getSessions();
        if (res.success) {
          setSessions(res.sessions || []);
        }
      } catch (err) {
        showNotification('Failed to fetch admin sessions: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchSessions();
    }, []);

    const handleRevoke = async (sessionId) => {
      const reason = prompt('Enter a reason for session revocation (optional):', 'Administrative termination');
      if (reason === null) return;

      setRevokingId(sessionId);
      try {
        const res = await window.OV.services.admin.revokeSession(sessionId, reason);
        if (res.success) {
          showNotification('Admin session successfully revoked.');
          fetchSessions();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setRevokingId(null);
      }
    };

    return (
      <div>
        {toastMsg && (
          <div style={{
            position: 'fixed',
            top: 24,
            right: 24,
            background: '#10b981',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            zIndex: 9999,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          }}>
            ✓ {toastMsg}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px', color: '#fff' }}>
              Active Administrator Sessions
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Session accountability with sliding 30-minute inactivity timeouts and remote token revocation.
            </p>
          </div>
          <button
            onClick={fetchSessions}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 Refresh Sessions
          </button>
        </div>

        {/* Sessions Table */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              <div className="spin" style={{ margin: '0 auto 12px', width: 24, height: 24 }} />
              Loading active sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              No active administrator sessions found.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '14px 18px' }}>Admin User</th>
                    <th style={{ padding: '14px 18px' }}>IP Address</th>
                    <th style={{ padding: '14px 18px' }}>User Agent / Device</th>
                    <th style={{ padding: '14px 18px' }}>Last Active</th>
                    <th style={{ padding: '14px 18px' }}>Expires In</th>
                    <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const minutesLeft = Math.max(0, Math.round((new Date(s.expires_at) - new Date()) / 60000));
                    return (
                      <tr key={s.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{s.admin?.name || 'Administrator'}</div>
                          <div style={{ fontSize: 12, color: '#818cf8' }}>{s.admin?.email}</div>
                        </td>
                        <td style={{ padding: '14px 18px', color: '#cbd5e1', fontFamily: 'monospace' }}>
                          {s.ip_address}
                        </td>
                        <td style={{ padding: '14px 18px', color: '#94a3b8', maxWidth: 280 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.user_agent}>
                            {s.user_agent || 'Unknown Browser'}
                          </div>
                        </td>
                        <td style={{ padding: '14px 18px', color: '#94a3b8' }}>
                          {s.last_activity_at ? new Date(s.last_activity_at).toLocaleTimeString() : 'Recent'}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: minutesLeft < 5 ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                            color: minutesLeft < 5 ? '#f87171' : '#34d399',
                          }}>
                            {minutesLeft} mins
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <button
                            disabled={revokingId === s.id}
                            onClick={() => handleRevoke(s.id)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              background: 'rgba(239,68,68,0.15)',
                              border: '1px solid rgba(239,68,68,0.3)',
                              color: '#f87171',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {revokingId === s.id ? 'Revoking...' : 'Revoke Session'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.AdminSessionsPage = AdminSessionsPage;
})();

