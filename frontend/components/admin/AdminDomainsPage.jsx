/**
 * OneVue Domain Registry & RBAC Permission Matrix UI
 * Mounted at #/admin/domains
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;

  function AdminDomainsPage() {
    const [tab, setTab] = useState('domains'); // 'domains' | 'roles'
    const [domains, setDomains] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newDomain, setNewDomain] = useState({ domainKey: '', name: '', description: '', allowedActions: ['read', 'write', 'create', 'delete', 'manage'] });
    const [toastMsg, setToastMsg] = useState(null);

    const showNotification = (msg) => {
      setToastMsg(msg);
      setTimeout(() => setToastMsg(null), 3500);
    };

    const loadData = async () => {
      setLoading(true);
      try {
        const [domData, rolesData] = await Promise.all([
          window.OV.services.admin.getDomains(),
          window.OV.services.admin.getRoles(),
        ]);
        setDomains(domData || []);
        setRoles(rolesData || []);
      } catch (err) {
        showNotification('Failed to load domains: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      loadData();
    }, []);

    const handleCreateDomain = async (e) => {
      e.preventDefault();
      try {
        setSaving(true);
        await window.OV.services.admin.createDomain(newDomain);
        showNotification(`Domain '${newDomain.name}' registered successfully!`);
        setShowAddModal(false);
        setNewDomain({ domainKey: '', name: '', description: '', allowedActions: ['read', 'write', 'create', 'delete', 'manage'] });
        await loadData();
      } catch (err) {
        alert(err.message);
      } finally {
        setSaving(false);
      }
    };

    const togglePermission = (roleName, domainKey, action) => {
      setRoles((prevRoles) => {
        return prevRoles.map((r) => {
          if (r.role !== roleName) return r;
          const permissions = [...(r.permissions || [])];
          const existing = permissions.find((p) => p.domainKey === domainKey);

          if (!existing) {
            permissions.push({ domainKey, actions: [action] });
          } else {
            const actions = [...existing.actions];
            const idx = actions.indexOf(action);
            if (idx >= 0) {
              actions.splice(idx, 1);
            } else {
              actions.push(action);
            }
            existing.actions = actions;
          }

          return { ...r, permissions };
        });
      });
    };

    const saveRolePermissions = async (roleObj) => {
      try {
        setSaving(true);
        await window.OV.services.admin.updateRolePermissions(roleObj.role, roleObj.permissions, roleObj.description);
        showNotification(`Permissions saved for role '${roleObj.name}'`);
      } catch (err) {
        alert('Failed to save permissions: ' + err.message);
      } finally {
        setSaving(false);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px', color: '#fff' }}>
              Domains & Access Control (RBAC)
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
              Extensible domain registry and permission mappings across organization roles.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary"
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              + Register New Domain
            </button>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: 24 }}>
          <button
            onClick={() => setTab('domains')}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              color: tab === 'domains' ? '#fff' : '#94a3b8',
              background: 'none',
              border: 'none',
              borderBottom: tab === 'domains' ? '2px solid #6366f1' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Registered Domains ({domains.length})
          </button>
          <button
            onClick={() => setTab('roles')}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              color: tab === 'roles' ? '#fff' : '#94a3b8',
              background: 'none',
              border: 'none',
              borderBottom: tab === 'roles' ? '2px solid #6366f1' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Permission Matrix & Roles ({roles.length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <div className="spin" style={{ width: 28, height: 28, margin: '0 auto' }} />
          </div>
        ) : tab === 'domains' ? (
          /* Domains List */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
            {domains.map((dom) => (
              <div
                key={dom.domainKey}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 14,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <code style={{ fontSize: 12, color: '#a5b4fc', background: 'rgba(99, 102, 241, 0.15)', padding: '3px 8px', borderRadius: 6 }}>
                      {dom.domainKey}
                    </code>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: dom.isSystem ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: dom.isSystem ? '#60a5fa' : '#34d399',
                    }}>
                      {dom.isSystem ? 'System Core' : 'Custom Extension'}
                    </span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: '#fff', margin: '0 0 6px' }}>
                    {dom.name}
                  </h3>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.5 }}>
                    {dom.description}
                  </p>
                </div>

                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#64748b', fontWeight: 600, marginBottom: 8 }}>
                    Allowed Domain Actions
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(dom.allowedActions || []).map((action) => (
                      <span
                        key={action}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: 'rgba(255, 255, 255, 0.06)',
                          color: '#cbd5e1',
                        }}
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Role Permission Matrix */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {roles.map((r) => (
              <div
                key={r.role}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 14,
                  padding: 24,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#fff' }}>
                        {r.name}
                      </h3>
                      <code style={{ fontSize: 12, color: '#a5b4fc', background: 'rgba(99, 102, 241, 0.15)', padding: '2px 8px', borderRadius: 6 }}>
                        {r.role}
                      </code>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>{r.description}</p>
                  </div>
                  {r.role !== 'super_admin' && (
                    <button
                      onClick={() => saveRolePermissions(r)}
                      disabled={saving}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: '#6366f1',
                        color: '#fff',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {saving ? 'Saving...' : 'Save Matrix'}
                    </button>
                  )}
                </div>

                {/* Permissions Grid */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                        <th style={{ padding: '10px 14px', color: '#94a3b8' }}>Domain</th>
                        {['read', 'write', 'create', 'delete', 'publish', 'manage'].map((act) => (
                          <th key={act} style={{ padding: '10px 14px', color: '#94a3b8', textTransform: 'capitalize' }}>
                            {act}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map((dom) => {
                        const perm = (r.permissions || []).find((p) => p.domainKey === dom.domainKey);
                        const actions = perm ? perm.actions : [];
                        const isSuperAdmin = r.role === 'super_admin';

                        return (
                          <tr key={dom.domainKey} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '12px 14px', fontWeight: 500, color: '#fff' }}>
                              {dom.name}
                              <div style={{ fontSize: 11, color: '#64748b' }}>{dom.domainKey}</div>
                            </td>
                            {['read', 'write', 'create', 'delete', 'publish', 'manage'].map((act) => {
                              const checked = isSuperAdmin || actions.includes('*') || actions.includes(act);
                              return (
                                <td key={act} style={{ padding: '12px 14px' }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={isSuperAdmin}
                                    onChange={() => togglePermission(r.role, dom.domainKey, act)}
                                    style={{ width: 16, height: 16, cursor: isSuperAdmin ? 'not-allowed' : 'pointer' }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal: Add Domain */}
        {showAddModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 20,
          }}>
            <div style={{
              background: '#0f1420',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16,
              padding: 32,
              width: '100%',
              maxWidth: 500,
            }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: '#fff' }}>
                Register Platform Domain
              </h2>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>
                Create a new domain key to map future controls and permission roles.
              </p>

              <form onSubmit={handleCreateDomain} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#cbd5e1' }}>
                    Domain Key (e.g. domain.ai_tools)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="domain.ai_tools"
                    value={newDomain.domainKey}
                    onChange={(e) => setNewDomain({ ...newDomain, domainKey: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 8,
                      color: '#fff',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#cbd5e1' }}>
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="AI Portfolio Coach"
                    value={newDomain.name}
                    onChange={(e) => setNewDomain({ ...newDomain, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 8,
                      color: '#fff',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#cbd5e1' }}>
                    Description
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Controls for AI recommendations and automated portfolio suggestions."
                    value={newDomain.description}
                    onChange={(e) => setNewDomain({ ...newDomain, description: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: 8,
                      color: '#fff',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    style={{
                      padding: '10px 18px',
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#94a3b8',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: '10px 20px',
                      background: '#6366f1',
                      border: 'none',
                      color: '#fff',
                      fontWeight: 600,
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    {saving ? 'Registering...' : 'Register Domain'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AdminDomainsPage = AdminDomainsPage;
})();
