/**
 * OneVue User Directory & Safeguarded Account Management
 * Mounted at #/admin/users
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminUsersPage() {
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [identity, setIdentity] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [toastMsg, setToastMsg] = useState(null);

    // Multi-selection for bulk operations
    const [selectedUserIds, setSelectedUserIds] = useState([]);

    // Impact Preview Modal
    const [previewUser, setPreviewUser] = useState(null);
    const [previewStats, setPreviewStats] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Safeguarded Block Dialog
    const [blockModalUser, setBlockModalUser] = useState(null);
    const [blockReason, setBlockReason] = useState('');
    const [blockDuration, setBlockDuration] = useState('7');
    const [submittingBlock, setSubmittingBlock] = useState(false);

    // Warning Dialog
    const [warnModalUser, setWarnModalUser] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [warnMessage, setWarnMessage] = useState('');
    const [warnSeverity, setWarnSeverity] = useState('medium');
    const [submittingWarn, setSubmittingWarn] = useState(false);

    // User History Timeline Modal
    const [historyUser, setHistoryUser] = useState(null);
    const [historyList, setHistoryList] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Bulk Block Confirmation Modal
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkReason, setBulkReason] = useState('Violations of community guidelines');
    const [bulkDuration, setBulkDuration] = useState('14');
    const [bulkConfirmationToken, setBulkConfirmationToken] = useState(null);
    const [bulkPreviewList, setBulkPreviewList] = useState([]);
    const [submittingBulk, setSubmittingBulk] = useState(false);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const fetchUsers = async (targetPage = 1) => {
      setLoading(true);
      try {
        const res = await window.OV.services.admin.getUsers({
          page: targetPage,
          limit: 20,
          identity: identity || undefined,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
        });

        if (res.success) {
          setUsers(res.users || []);
          setTotal(res.total || 0);
          setPage(res.page || 1);
          setTotalPages(res.totalPages || 1);
          setSelectedUserIds([]);
        }
      } catch (err) {
        showNotification('Failed to fetch users: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchUsers(1);
    }, [identity, statusFilter]);

    useEffect(() => {
      window.OV.services.admin.getWarningTemplates().then(setTemplates).catch(() => {});
    }, []);

    const handleSearchSubmit = (e) => {
      e.preventDefault();
      fetchUsers(1);
    };

    // 1. Pre-action Safeguard Impact Preview
    const handleOpenPreview = async (userId) => {
      setLoadingPreview(true);
      setPreviewUser(null);
      setPreviewStats(null);
      try {
        const res = await window.OV.services.admin.getUserPreview(userId);
        if (res.success) {
          setPreviewUser(res.user);
          setPreviewStats(res.stats);
        }
      } catch (err) {
        alert('Failed to preview user impact: ' + err.message);
      } finally {
        setLoadingPreview(false);
      }
    };

    // 2. Open Block Modal
    const handleOpenBlockModal = (userObj) => {
      setBlockModalUser(userObj);
      setBlockReason('');
      setBlockDuration('7');
    };

    const handleExecuteBlock = async () => {
      if (!blockReason.trim() || blockReason.trim().length < 10) {
        alert('A clear reason of at least 10 characters is mandatory to block an account.');
        return;
      }
      setSubmittingBlock(true);
      try {
        const durationDays = blockDuration === 'indefinite' ? null : parseInt(blockDuration, 10);
        const res = await window.OV.services.admin.blockUser(blockModalUser._id || blockModalUser.id, {
          reason: blockReason.trim(),
          duration_days: durationDays,
        });
        if (res.success) {
          showNotification(`User ${blockModalUser.email} has been blocked.`);
          setBlockModalUser(null);
          fetchUsers(page);
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setSubmittingBlock(false);
      }
    };

    // 3. Unblock User
    const handleUnblock = async (userObj) => {
      const reason = prompt(`Enter reason to unblock ${userObj.email} (min 10 chars):`, 'Account reviewed and restored');
      if (!reason) return;
      if (reason.trim().length < 10) {
        alert('Reason must be at least 10 characters.');
        return;
      }
      try {
        const res = await window.OV.services.admin.unblockUser(userObj._id || userObj.id, reason.trim());
        if (res.success) {
          showNotification(`User ${userObj.email} has been restored to active.`);
          fetchUsers(page);
        }
      } catch (err) {
        alert(err.message);
      }
    };

    // 4. Open Warn Modal
    const handleOpenWarnModal = (userObj) => {
      setWarnModalUser(userObj);
      setSelectedTemplateId('');
      setWarnMessage('');
      setWarnSeverity('medium');
    };

    const handleTemplateSelect = (tplId) => {
      setSelectedTemplateId(tplId);
      const t = templates.find((x) => x._id === tplId);
      if (t) {
        setWarnMessage(t.message);
        setWarnSeverity(t.severityLevel);
      }
    };

    const handleExecuteWarn = async () => {
      if (!warnMessage.trim() || warnMessage.trim().length < 5) {
        alert('Warning message must be at least 5 characters.');
        return;
      }
      setSubmittingWarn(true);
      try {
        const res = await window.OV.services.admin.warnUser(warnModalUser._id || warnModalUser.id, {
          template_id: selectedTemplateId || undefined,
          message: warnMessage.trim(),
          severity_level: warnSeverity,
          is_anonymous: true,
        });
        if (res.success) {
          showNotification(`Disciplinary warning issued to ${warnModalUser.email}.`);
          setWarnModalUser(null);
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setSubmittingWarn(false);
      }
    };

    // 5. Open History Timeline Modal
    const handleOpenHistory = async (userObj) => {
      setHistoryUser(userObj);
      setLoadingHistory(true);
      setHistoryList([]);
      try {
        const res = await window.OV.services.admin.getUserHistory(userObj._id || userObj.id);
        if (res.success) {
          setHistoryList(res.changes || []);
        }
      } catch (err) {
        alert('Failed to load change history: ' + err.message);
      } finally {
        setLoadingHistory(false);
      }
    };

    // 6. Bulk Selection Handlers
    const toggleSelectAll = (e) => {
      if (e.target.checked) {
        setSelectedUserIds(users.filter((u) => u.role !== 'super_admin').map((u) => u._id || u.id));
      } else {
        setSelectedUserIds([]);
      }
    };

    const toggleSelectUser = (id) => {
      setSelectedUserIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    };

    const handleOpenBulkBlock = async () => {
      if (selectedUserIds.length === 0) return;
      setSubmittingBulk(true);
      setShowBulkModal(true);
      setBulkConfirmationToken(null);
      try {
        const res = await window.OV.services.admin.bulkBlockPreview({
          user_ids: selectedUserIds,
          reason: bulkReason,
          duration_days: bulkDuration === 'indefinite' ? null : parseInt(bulkDuration, 10),
        });
        if (res.success) {
          setBulkPreviewList(res.preview || []);
          setBulkConfirmationToken(res.confirmation_token);
        }
      } catch (err) {
        alert('Failed to prepare bulk preview: ' + err.message);
        setShowBulkModal(false);
      } finally {
        setSubmittingBulk(false);
      }
    };

    const handleConfirmBulkBlock = async () => {
      if (!bulkConfirmationToken) return;
      setSubmittingBulk(true);
      try {
        const res = await window.OV.services.admin.bulkBlockConfirm(bulkConfirmationToken);
        if (res.success) {
          showNotification(res.message);
          setShowBulkModal(false);
          setSelectedUserIds([]);
          fetchUsers(page);
        }
      } catch (err) {
        alert(err.message);
      } finally {
        setSubmittingBulk(false);
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
              User Directory & Safeguards
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Governance with pre-action impact previews, mandatory reasons, and 2-step bulk execution.
            </p>
          </div>
          {selectedUserIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', padding: '6px 14px', borderRadius: 10 }}>
              <span style={{ fontSize: 13, color: '#c7d2fe', fontWeight: 600 }}>
                {selectedUserIds.length} users selected
              </span>
              <button
                onClick={handleOpenBulkBlock}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Bulk Block Batch
              </button>
            </div>
          )}
        </div>

        {/* Filters Bar */}
        <div style={{
          display: 'flex',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 360 }}>
            <input
              type="text"
              placeholder="Search email, name, username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                background: '#6366f1',
                border: 'none',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Search
            </button>
          </form>

          <div style={{ display: 'flex', gap: 10 }}>
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
              <option value="" style={{ background: '#0f172a' }}>All Statuses</option>
              <option value="active" style={{ background: '#0f172a' }}>Active</option>
              <option value="blocked" style={{ background: '#0f172a' }}>Blocked</option>
              <option value="suspended" style={{ background: '#0f172a' }}>Suspended</option>
              <option value="deleted" style={{ background: '#0f172a' }}>Deleted</option>
            </select>

            <select
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 13,
              }}
            >
              <option value="" style={{ background: '#0f172a' }}>All Identities</option>
              <option value="student" style={{ background: '#0f172a' }}>Student</option>
              <option value="professional" style={{ background: '#0f172a' }}>Professional</option>
              <option value="freelancer" style={{ background: '#0f172a' }}>Freelancer</option>
              <option value="creator" style={{ background: '#0f172a' }}>Creator</option>
              <option value="business" style={{ background: '#0f172a' }}>Business</option>
            </select>
          </div>
        </div>

        {/* Users Table */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              <div className="spin" style={{ margin: '0 auto 12px', width: 24, height: 24 }} />
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
              No users found matching query.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8' }}>
                    <th style={{ padding: '14px 16px', width: 40 }}>
                      <input
                        type="checkbox"
                        onChange={toggleSelectAll}
                        checked={selectedUserIds.length > 0 && selectedUserIds.length === users.filter((u) => u.role !== 'super_admin').length}
                      />
                    </th>
                    <th style={{ padding: '14px 18px' }}>User</th>
                    <th style={{ padding: '14px 18px' }}>Identity</th>
                    <th style={{ padding: '14px 18px' }}>Role</th>
                    <th style={{ padding: '14px 18px' }}>Status</th>
                    <th style={{ padding: '14px 18px' }}>Registered</th>
                    <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const uid = u._id || u.id;
                    const isSelected = selectedUserIds.includes(uid);
                    return (
                      <tr key={uid} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', background: isSelected ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                        <td style={{ padding: '14px 16px' }}>
                          {u.role !== 'super_admin' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectUser(uid)}
                            />
                          )}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{u.name}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{u.email}</div>
                          {u.username && <div style={{ fontSize: 11, color: '#6366f1' }}>@{u.username}</div>}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: 'capitalize',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: '#cbd5e1',
                          }}>
                            {u.identity || 'unassigned'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background: u.role === 'super_admin' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                            color: u.role === 'super_admin' ? '#a5b4fc' : '#94a3b8',
                          }}>
                            {u.role || 'user'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background: u.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : u.status === 'blocked' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: u.status === 'active' ? '#34d399' : u.status === 'blocked' ? '#f87171' : '#fbbf24',
                          }}>
                            {u.status || 'active'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px', color: '#94a3b8' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              onClick={() => handleOpenPreview(uid)}
                              title="Pre-action impact preview"
                              style={{
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: 'rgba(99,102,241,0.1)',
                                border: '1px solid rgba(99,102,241,0.25)',
                                color: '#818cf8',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                              }}
                            >
                              🔍 Preview
                            </button>

                            <button
                              onClick={() => handleOpenWarnModal(u)}
                              title="Send policy warning"
                              style={{
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: 'rgba(245,158,11,0.1)',
                                border: '1px solid rgba(245,158,11,0.25)',
                                color: '#fbbf24',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                              }}
                            >
                              ⚠️ Warn
                            </button>

                            {u.status === 'blocked' ? (
                              <button
                                onClick={() => handleUnblock(u)}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  background: 'rgba(16,185,129,0.15)',
                                  border: '1px solid rgba(16,185,129,0.3)',
                                  color: '#34d399',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                }}
                              >
                                Restore
                              </button>
                            ) : (
                              u.role !== 'super_admin' && (
                                <button
                                  onClick={() => handleOpenBlockModal(u)}
                                  style={{
                                    padding: '5px 10px',
                                    borderRadius: 6,
                                    background: 'rgba(239,68,68,0.1)',
                                    border: '1px solid rgba(239,68,68,0.25)',
                                    color: '#f87171',
                                    fontSize: 12,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Block
                                </button>
                              )
                            )}

                            <button
                              onClick={() => handleOpenHistory(u)}
                              title="View change history"
                              style={{
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#cbd5e1',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                              }}
                            >
                              Timeline
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 1. Preview Modal */}
        {(previewUser || loadingPreview) && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24, color: '#fff' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>Pre-Action Safeguard Impact Preview</h3>
              {loadingPreview ? (
                <div style={{ padding: 24, textAlign: 'center' }}>Loading impact preview...</div>
              ) : (
                <div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 10, marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{previewUser?.name} ({previewUser?.email})</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Role: {previewUser?.role} &bull; Status: {previewUser?.status}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Visiting Cards</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#818cf8', marginTop: 4 }}>{previewStats?.card_count || 0}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Website Claimed</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: previewStats?.website_claimed ? '#34d399' : '#94a3b8', marginTop: 4 }}>
                        {previewStats?.website_claimed ? 'Yes' : 'No'}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>
                    Notice: Inspecting this preview has been logged to the immutable administrative access audit stream.
                  </div>
                  <button onClick={() => setPreviewUser(null)} style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#6366f1', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                    Close Preview
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Block Modal */}
        {blockModalUser && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24, color: '#fff' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#f87171' }}>Block Account: {blockModalUser.email}</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>Enforces platform suspension. The user will be unable to sign in.</p>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>Suspension Duration:</label>
                <select value={blockDuration} onChange={(e) => setBlockDuration(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 8, color: '#fff' }}>
                  <option value="7" style={{ background: '#0f172a' }}>7 Days</option>
                  <option value="14" style={{ background: '#0f172a' }}>14 Days</option>
                  <option value="30" style={{ background: '#0f172a' }}>30 Days</option>
                  <option value="90" style={{ background: '#0f172a' }}>90 Days</option>
                  <option value="indefinite" style={{ background: '#0f172a' }}>Indefinite / Permanent</option>
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>Mandatory Audit Reason (Min 10 characters):</label>
                <textarea value={blockReason} onChange={(e) => setBlockReason(e.target.value)} rows={3} placeholder="Provide specific policy or behavioral reason..." style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 10, color: '#fff', fontSize: 13 }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setBlockModalUser(null)} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                <button disabled={submittingBlock} onClick={handleExecuteBlock} style={{ padding: '8px 18px', borderRadius: 8, background: '#ef4444', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {submittingBlock ? 'Blocking...' : 'Confirm Block'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. Warn Modal */}
        {warnModalUser && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, color: '#fff' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#fbbf24' }}>Issue Disciplinary Warning: {warnModalUser.email}</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>Sender identity is masked as "Trust & Safety Team" to prevent retaliation.</p>

              {templates.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>Standard Template (Optional):</label>
                  <select value={selectedTemplateId} onChange={(e) => handleTemplateSelect(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 8, color: '#fff' }}>
                    <option value="" style={{ background: '#0f172a' }}>Custom message</option>
                    {templates.map((t) => (
                      <option key={t._id} value={t._id} style={{ background: '#0f172a' }}>{t.title} ({t.severityLevel})</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>Severity Level:</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {['low', 'medium', 'high'].map((sev) => (
                    <button key={sev} type="button" onClick={() => setWarnSeverity(sev)} style={{ flex: 1, padding: '7px', borderRadius: 6, textTransform: 'capitalize', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: warnSeverity === sev ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)', background: warnSeverity === sev ? 'rgba(99,102,241,0.2)' : 'transparent', color: warnSeverity === sev ? '#a5b4fc' : '#94a3b8' }}>
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>Warning Message:</label>
                <textarea value={warnMessage} onChange={(e) => setWarnMessage(e.target.value)} rows={3} style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 10, color: '#fff', fontSize: 13 }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setWarnModalUser(null)} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                <button disabled={submittingWarn} onClick={handleExecuteWarn} style={{ padding: '8px 18px', borderRadius: 8, background: '#f59e0b', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {submittingWarn ? 'Sending...' : 'Send Warning'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. Timeline Modal */}
        {historyUser && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: '100%', maxWidth: 560, padding: 24, color: '#fff', maxHeight: '85vh', overflowY: 'auto' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Change Timeline: {historyUser.email}</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>Immutable audit records of all account status modifications.</p>

              {loadingHistory ? (
                <div style={{ padding: 24, textAlign: 'center' }}>Loading timeline...</div>
              ) : historyList.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No status changes recorded for this user.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {historyList.map((item) => (
                    <div key={item.id} style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, borderLeft: '3px solid #6366f1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 12, color: item.newStatus === 'blocked' ? '#f87171' : '#34d399' }}>
                          {item.previousStatus} &rarr; {item.newStatus}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{new Date(item.changedAt).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#cbd5e1' }}>"{item.changeReason}"</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Changed by: {item.changedByAdmin?.email || 'Administrator'}</div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setHistoryUser(null)} style={{ marginTop: 20, width: '100%', padding: '10px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Close Timeline
              </button>
            </div>
          </div>
        )}

        {/* 5. Bulk Block Modal */}
        {showBulkModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
            <div style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, width: '100%', maxWidth: 540, padding: 24, color: '#fff' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#f87171' }}>2-Step Cryptographic Bulk Block</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                Preview confirmed for {bulkPreviewList.length} accounts. A signed confirmation token is bound to this action.
              </p>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, maxHeight: 160, overflowY: 'auto', marginBottom: 16 }}>
                {bulkPreviewList.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span>{p.name} ({p.email})</span>
                    <span style={{ color: '#94a3b8' }}>Status: {p.current_status}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setShowBulkModal(false)} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                <button disabled={submittingBulk} onClick={handleConfirmBulkBlock} style={{ padding: '8px 18px', borderRadius: 8, background: '#ef4444', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {submittingBulk ? 'Executing...' : 'Confirm Bulk Block'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AdminUsersPage = AdminUsersPage;
})();
