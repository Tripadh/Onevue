/**
 * OneVue Admin Ban Appeals Management Page
 * Mounted at #/admin/appeals
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminAppealsPage() {
    const [appeals, setAppeals] = useState([]);
    const [total, setTotal] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('pending');
    const [loading, setLoading] = useState(true);
    const [toastMsg, setToastMsg] = useState(null);
    const [selectedAppeal, setSelectedAppeal] = useState(null);
    const [reviewAction, setReviewAction] = useState('approve');
    const [reviewReason, setReviewReason] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const fetchAppeals = async () => {
      setLoading(true);
      try {
        const res = await window.OV.services.admin.getAppeals({
          status: statusFilter,
          limit: 50,
        });
        if (res.success) {
          setAppeals(res.appeals || []);
          setTotal(res.total || 0);
          setPendingCount(res.pending_count || 0);
        }
      } catch (err) {
        showNotification('Failed to load appeals: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchAppeals();
    }, [statusFilter]);

    const handleOpenReview = (appeal, action) => {
      setSelectedAppeal(appeal);
      setReviewAction(action);
      setReviewReason(
        action === 'approve'
          ? 'Account terms verified. Satisfactory explanation provided. Access restored.'
          : 'Violation is severe or repeated. Appeal rejected.'
      );
    };

    const handleExecuteReview = async () => {
      if (!selectedAppeal) return;
      if (!reviewReason.trim() || reviewReason.trim().length < 5) {
        alert('Please provide a review reason of at least 5 characters.');
        return;
      }
      setSubmittingReview(true);
      try {
        const res = await window.OV.services.admin.reviewAppeal(selectedAppeal.id, {
          action: reviewAction,
          review_reason: reviewReason.trim(),
        });
        if (res.success) {
          showNotification(`Appeal ${reviewAction}d successfully.`);
          setSelectedAppeal(null);
          fetchAppeals();
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setSubmittingReview(false);
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
              Ban Appeals & Restoration Queue
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Review suspended and blocked account appeal statements with audit accountability.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {['pending', 'approved', 'rejected', 'all'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                  border: statusFilter === st ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                  background: statusFilter === st ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                  color: statusFilter === st ? '#fff' : '#94a3b8',
                }}
              >
                {st} {st === 'pending' && pendingCount > 0 ? `(${pendingCount})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Appeals Table */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              <div className="spin" style={{ margin: '0 auto 12px', width: 24, height: 24 }} />
              Loading appeals...
            </div>
          ) : appeals.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              No {statusFilter} ban appeals in the queue.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '14px 18px' }}>User</th>
                    <th style={{ padding: '14px 18px' }}>Original Ban Reason</th>
                    <th style={{ padding: '14px 18px' }}>Appeal Statement</th>
                    <th style={{ padding: '14px 18px' }}>Submitted</th>
                    <th style={{ padding: '14px 18px' }}>Status</th>
                    <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {appeals.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{item.user?.name || 'User'}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{item.contact_email || item.user?.email}</div>
                      </td>
                      <td style={{ padding: '14px 18px', color: '#f87171', maxWidth: 220 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.original_ban_reason}>
                          {item.original_ban_reason || 'Disciplinary violation'}
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px', color: '#cbd5e1', maxWidth: 300 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.appeal_message}>
                          "{item.appeal_message}"
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                        {item.appealed_at ? new Date(item.appealed_at).toLocaleDateString() : 'Recent'}
                      </td>
                      <td style={{ padding: '14px 18px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: item.appeal_status === 'approved' ? 'rgba(16,185,129,0.15)' : item.appeal_status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                          color: item.appeal_status === 'approved' ? '#34d399' : item.appeal_status === 'rejected' ? '#f87171' : '#fbbf24',
                        }}>
                          {item.appeal_status}
                        </span>
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        {item.appeal_status === 'pending' ? (
                          <div style={{ display: 'inline-flex', gap: 8 }}>
                            <button
                              onClick={() => handleOpenReview(item, 'approve')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 6,
                                background: 'rgba(16,185,129,0.15)',
                                border: '1px solid rgba(16,185,129,0.3)',
                                color: '#34d399',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleOpenReview(item, 'reject')}
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
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: '#64748b' }}>
                            Reviewed {item.reviewed_by ? `by ${item.reviewed_by.name}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Review Modal */}
        {selectedAppeal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.75)',
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
              maxWidth: 520,
              padding: 24,
              color: '#fff',
            }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>
                {reviewAction === 'approve' ? 'Approve Appeal & Restore User' : 'Reject Ban Appeal'}
              </h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                User: <strong>{selectedAppeal.user?.email || selectedAppeal.contact_email}</strong>
              </p>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>User's Statement:</div>
                <div style={{ color: '#cbd5e1', fontStyle: 'italic' }}>"{selectedAppeal.appeal_message}"</div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                  Administrative Review Reason (Min 5 chars):
                </label>
                <textarea
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
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
                  onClick={() => setSelectedAppeal(null)}
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
                  disabled={submittingReview}
                  onClick={handleExecuteReview}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    background: reviewAction === 'approve' ? '#10b981' : '#ef4444',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {submittingReview ? 'Processing...' : `Confirm ${reviewAction === 'approve' ? 'Restoration' : 'Rejection'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AdminAppealsPage = AdminAppealsPage;
})();

