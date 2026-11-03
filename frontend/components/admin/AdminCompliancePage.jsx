/**
 * OneVue Admin Compliance & GDPR Privacy Console
 * Mounted at #/admin/compliance
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminCompliancePage() {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pendingCount, setPendingCount] = useState(0);
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [toastMsg, setToastMsg] = useState(null);

    // GDPR action modals
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportUserId, setExportUserId] = useState('');
    const [exportReason, setExportReason] = useState('GDPR Article 15 Data Subject Access Request');
    const [exportResult, setExportResult] = useState(null);
    const [exporting, setExporting] = useState(false);

    const [showErasureModal, setShowErasureModal] = useState(false);
    const [erasureUserId, setErasureUserId] = useState('');
    const [erasureReason, setErasureReason] = useState('GDPR Article 17 Right to Erasure request verified');
    const [erasing, setErasing] = useState(false);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const fetchRequests = async () => {
      setLoading(true);
      try {
        const res = await window.OV.services.admin.getComplianceRequests({
          type: typeFilter !== 'all' ? typeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          limit: 50,
        });
        if (res.success) {
          setRequests(res.requests || []);
          setPendingCount(res.pending_count || 0);
        }
      } catch (err) {
        showNotification('Failed to fetch compliance requests: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchRequests();
    }, [typeFilter, statusFilter]);

    const handleExecuteExport = async () => {
      if (!exportUserId.trim()) {
        alert('Please enter a User ID.');
        return;
      }
      setExporting(true);
      try {
        const res = await window.OV.services.admin.exportRightToAccess(exportUserId.trim(), exportReason.trim());
        if (res.success) {
          setExportResult(res.data_archive);
          showNotification('Data archive generated successfully.');
          fetchRequests();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setExporting(false);
      }
    };

    const handleExecuteErasure = async () => {
      if (!erasureUserId.trim()) {
        alert('Please enter a User ID.');
        return;
      }
      if (!erasureReason.trim() || erasureReason.trim().length < 10) {
        alert('A reason of at least 10 characters is mandatory for GDPR erasure.');
        return;
      }
      if (!confirm(`CAUTION: Are you sure you want to scrub all PII and permanently deactivate user ${erasureUserId}?`)) return;

      setErasing(true);
      try {
        const res = await window.OV.services.admin.executeGdprDeletion({
          user_id: erasureUserId.trim(),
          reason: erasureReason.trim(),
          immediate_scrub: true,
        });
        if (res.success) {
          showNotification('GDPR erasure executed and PII scrubbed.');
          setShowErasureModal(false);
          setErasureUserId('');
          fetchRequests();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setErasing(false);
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
              Compliance & GDPR Privacy Suite
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Manage Article 15 (Right of Access) archives and Article 17 (Right to Erasure) scrubbing.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => { setShowExportModal(true); setExportResult(null); }}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                background: '#6366f1',
                border: 'none',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Generate Access Bundle
            </button>
            <button
              onClick={() => setShowErasureModal(true)}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🗑️ Execute Erasure
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 13,
            }}
          >
            <option value="all" style={{ background: '#0f172a' }}>All Request Types</option>
            <option value="right_to_access" style={{ background: '#0f172a' }}>Right to Access (Art. 15)</option>
            <option value="gdpr_deletion" style={{ background: '#0f172a' }}>Right to Erasure (Art. 17)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 13,
            }}
          >
            <option value="all" style={{ background: '#0f172a' }}>All Statuses</option>
            <option value="pending" style={{ background: '#0f172a' }}>Pending Only</option>
            <option value="completed" style={{ background: '#0f172a' }}>Completed</option>
          </select>
        </div>

        {/* Requests Table */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              <div className="spin" style={{ margin: '0 auto 12px', width: 24, height: 24 }} />
              Loading compliance requests...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              No compliance requests found matching filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '14px 18px' }}>Request Type</th>
                    <th style={{ padding: '14px 18px' }}>User Subject</th>
                    <th style={{ padding: '14px 18px' }}>Requested At</th>
                    <th style={{ padding: '14px 18px' }}>Status</th>
                    <th style={{ padding: '14px 18px' }}>Processed By</th>
                    <th style={{ padding: '14px 18px' }}>Completion Date</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '14px 18px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          background: r.request_type === 'gdpr_deletion' ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
                          color: r.request_type === 'gdpr_deletion' ? '#f87171' : '#818cf8',
                        }}>
                          {r.request_type === 'gdpr_deletion' ? 'Article 17 Erasure' : 'Article 15 Access'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{r.user?.name || 'User'}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{r.user?.email || 'N/A'}</div>
                      </td>
                      <td style={{ padding: '14px 18px', color: '#94a3b8' }}>
                        {r.requested_at ? new Date(r.requested_at).toLocaleDateString() : 'N/A'}
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          background: r.status === 'completed' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: r.status === 'completed' ? '#34d399' : '#fbbf24',
                        }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', color: '#cbd5e1' }}>
                        {r.processed_by?.name || r.processed_by?.email || 'System'}
                      </td>
                      <td style={{ padding: '14px 18px', color: '#94a3b8' }}>
                        {r.completion_date ? new Date(r.completion_date).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right to Access Modal */}
        {showExportModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: 20,
          }}>
            <div style={{
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16,
              width: '100%',
              maxWidth: 620,
              padding: 24,
              color: '#fff',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>
                Generate Article 15 Right-of-Access Bundle
              </h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                Compiles the user's complete platform data archive into an authenticated export package.
              </p>

              {!exportResult ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                      Target User ID:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 6ad9bd7cf74ed542db7e4b3b"
                      value={exportUserId}
                      onChange={(e) => setExportUserId(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        color: '#fff',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                      Reason for Export:
                    </label>
                    <input
                      type="text"
                      value={exportReason}
                      onChange={(e) => setExportReason(e.target.value)}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        color: '#fff',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      onClick={() => setShowExportModal(false)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      disabled={exporting}
                      onClick={handleExecuteExport}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 8,
                        background: '#6366f1',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {exporting ? 'Generating Bundle...' : 'Compile & Export'}
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <div style={{
                    padding: 14,
                    borderRadius: 10,
                    background: 'rgba(16,185,129,0.15)',
                    border: '1px solid rgba(16,185,129,0.3)',
                    color: '#34d399',
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 16,
                  }}>
                    ✓ Archive generated successfully for {exportResult.account?.email}
                  </div>
                  <pre style={{
                    background: '#090d16',
                    padding: 14,
                    borderRadius: 10,
                    fontSize: 12,
                    color: '#a5b4fc',
                    maxHeight: 250,
                    overflowY: 'auto',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    {JSON.stringify(exportResult, null, 2)}
                  </pre>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(exportResult, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `onevue_gdpr_export_${exportResult.account?.id}.json`;
                        a.click();
                        a.remove();
                      }}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 8,
                        background: '#10b981',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginRight: 10,
                      }}
                    >
                      Download JSON Bundle
                    </button>
                    <button
                      onClick={() => setShowExportModal(false)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Erasure Modal */}
        {showErasureModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: 20,
          }}>
            <div style={{
              background: '#0f172a',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 16,
              width: '100%',
              maxWidth: 520,
              padding: 24,
              color: '#fff',
            }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px', color: '#f87171' }}>
                ⚠️ Execute GDPR Article 17 Erasure
              </h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                Soft-deletes user, anonymizes PII (name, email, bio, photo), and unpublishes all cards and websites.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                  Target User ID:
                </label>
                <input
                  type="text"
                  placeholder="e.g. 6ad9bd7cf74ed542db7e4b3b"
                  value={erasureUserId}
                  onChange={(e) => setErasureUserId(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: '#fff',
                    fontSize: 13,
                  }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                  Mandatory Legal Reason (Min 10 chars):
                </label>
                <textarea
                  value={erasureReason}
                  onChange={(e) => setErasureReason(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    padding: 10,
                    color: '#fff',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  onClick={() => setShowErasureModal(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={erasing}
                  onClick={handleExecuteErasure}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    background: '#ef4444',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {erasing ? 'Executing Erasure...' : 'Confirm Permanent Erasure'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AdminCompliancePage = AdminCompliancePage;
})();

