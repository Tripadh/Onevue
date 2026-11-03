/**
 * OneVue High-Signal Security & Operation Audit Logs UI
 * Mounted at #/admin/logs
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminAuditLogsPage() {
    const [logs, setLogs] = useState([]);
    const [domains, setDomains] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [purging, setPurging] = useState(false);
    const [expandedLogId, setExpandedLogId] = useState(null);

    // Filters
    const [severity, setSeverity] = useState('');
    const [selectedDomain, setSelectedDomain] = useState('');
    const [search, setSearch] = useState('');
    const [toastMsg, setToastMsg] = useState(null);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const fetchLogs = async (targetPage = 1) => {
      setLoading(true);
      try {
        const res = await window.OV.services.admin.getAuditLogs({
          page: targetPage,
          limit: 20,
          domain: selectedDomain || undefined,
          severity: severity || undefined,
          search: search.trim() || undefined,
        });

        if (res.success) {
          setLogs(res.logs || []);
          setTotal(res.total || 0);
          setPage(res.page || 1);
          setTotalPages(res.totalPages || 1);
        }
      } catch (err) {
        showNotification('Failed to fetch audit logs: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      window.OV.services.admin.getDomains().then(setDomains).catch(() => {});
      fetchLogs(1);
    }, [severity, selectedDomain]);

    const handleSearchSubmit = (e) => {
      e.preventDefault();
      fetchLogs(1);
    };

    const handlePurge = async () => {
      if (!confirm('Purge audit records older than 30 days to free up MongoDB Free Tier storage?')) {
        return;
      }
      try {
        setPurging(true);
        const res = await window.OV.services.admin.purgeAuditLogs(30);
        showNotification(res.message || 'Purged older audit records.');
        fetchLogs(1);
      } catch (err) {
        alert(err.message);
      } finally {
        setPurging(false);
      }
    };

    const getSeverityBadge = (sev) => {
      switch (sev) {
        case 'critical':
          return { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.35)' };
        case 'warning':
          return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)' };
        default:
          return { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.35)' };
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
              Security & Operations Audit Trail
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              High-signal, filtered governance records (zero noisy debug logs).
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handlePurge}
              disabled={purging}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                cursor: 'pointer',
              }}
            >
              {purging ? 'Purging...' : '🧹 Purge Logs (>30d)'}
            </button>
            <button
              onClick={() => fetchLogs(page)}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer',
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Severity Pills */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: '', label: 'All Severities' },
              { val: 'info', label: 'Info' },
              { val: 'warning', label: 'Warnings' },
              { val: 'critical', label: 'Critical' },
            ].map((s) => (
              <button
                key={s.val}
                onClick={() => setSeverity(s.val)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: severity === s.val ? '#6366f1' : 'rgba(255, 255, 255, 0.06)',
                  color: severity === s.val ? '#fff' : '#94a3b8',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Domain Dropdown & Search Form */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: '#0f1420',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="">All Domains</option>
              {domains.map((d) => (
                <option key={d.domainKey} value={d.domainKey}>
                  {d.name}
                </option>
              ))}
            </select>

            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Search actor, event..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  fontSize: 13,
                  minWidth: 200,
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Search
              </button>
            </form>
          </div>
        </div>

        {/* Logs Feed */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} />
          </div>
        ) : logs.length === 0 ? (
          <div style={{
            padding: 60,
            textAlign: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 14,
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            color: '#94a3b8',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🛡️</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>No Audit Logs Found</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>No events matched your current search filters.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {logs.map((log) => {
              const badge = getSeverityBadge(log.severity);
              const isExpanded = expandedLogId === log._id;

              return (
                <div
                  key={log._id}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '16px 20px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: badge.bg,
                          color: badge.text,
                          border: `1px solid ${badge.border}`,
                        }}>
                          {log.severity}
                        </span>

                        <code style={{ fontSize: 12, color: '#a5b4fc', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 4 }}>
                          {log.eventType}
                        </code>

                        <span style={{ fontSize: 12, color: '#64748b' }}>&bull;</span>

                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                          {log.domain}
                        </span>
                      </div>

                      <div style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc', marginBottom: 4 }}>
                        {log.actionSummary}
                      </div>

                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>Actor: <strong style={{ color: '#cbd5e1' }}>{log.actor?.email}</strong> ({log.actor?.role})</span>
                        {log.actor?.ipAddress && <span>IP: {log.actor.ipAddress}</span>}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </div>
                      {log.changes && (
                        <button
                          onClick={() => setExpandedLogId(isExpanded ? null : log._id)}
                          style={{
                            marginTop: 8,
                            padding: '4px 10px',
                            borderRadius: 6,
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#a5b4fc',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? 'Hide Payload ▲' : 'View Payload Diff ▼'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable JSON Diff */}
                  {isExpanded && log.changes && (
                    <div style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 8,
                      background: '#060910',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      overflowX: 'auto',
                    }}>
                      <pre style={{ margin: 0, color: '#38bdf8' }}>
                        {JSON.stringify(log.changes, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => fetchLogs(page - 1)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: page <= 1 ? '#475569' : '#fff',
                    border: 'none',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ← Previous
                </button>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>
                  Page {page} of {totalPages} ({total} events)
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => fetchLogs(page + 1)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: page >= totalPages ? '#475569' : '#fff',
                    border: 'none',
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  window.AdminAuditLogsPage = AdminAuditLogsPage;
})();
