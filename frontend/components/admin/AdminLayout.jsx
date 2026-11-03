/**
 * OneVue Organization Admin Layout Shell
 * Provides sidebar navigation, top bar status, and route guard for all #/admin/* views.
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;
  const { useNavigate, useLocation, Link } = ReactRouterDOM;

  function AdminLayout({ children, activeTab }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const s = window.OV?.services?.admin?.getSession();
      if (!s || !s.user || !['super_admin', 'admin', 'moderator'].includes(s.user.role)) {
        navigate('/admin/login', { replace: true });
        return;
      }
      setSession(s);
      setLoading(false);
    }, [navigate]);

    const handleLogout = () => {
      window.OV?.services?.admin?.logout();
      navigate('/admin/login', { replace: true });
    };

    if (loading || !session) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0a0d14', color: '#fff' }}>
          <div className="spin" style={{ width: 32, height: 32 }} />
        </div>
      );
    }

    const { user } = session;
    const currentPath = location.pathname;

    const navItems = [
      { path: '/admin/overview', label: 'Overview', icon: '📊' },
      { path: '/admin/users', label: 'Users & Safeguards', icon: '👥' },
      { path: '/admin/appeals', label: 'Ban Appeals', icon: '⚖️' },
      { path: '/admin/compliance', label: 'GDPR & Privacy', icon: '🛡️' },
      { path: '/admin/sessions', label: 'Active Sessions', icon: '🔐' },
      { path: '/admin/domains', label: 'Domains & RBAC', icon: '🌐' },
      { path: '/admin/logs', label: 'Security Audit Logs', icon: '📜' },
    ];

    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: '#090c15', color: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
        {/* Left Sidebar */}
        <aside style={{
          width: 260,
          background: 'rgba(15, 20, 32, 0.95)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '24px 16px',
          position: 'sticky',
          top: 0,
          height: '100vh',
          zIndex: 50,
        }}>
          <div>
            {/* Logo & Security Tag */}
            <div style={{ padding: '0 8px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 16,
                  color: '#fff',
                }}>
                  V
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', color: '#fff' }}>OneVue Admin</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Organization Console</div>
                </div>
              </div>
            </div>

            {/* Nav Menu */}
            <nav style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {navItems.map((item) => {
                const isActive = currentPath === item.path || (item.path === '/admin/overview' && currentPath === '/admin');
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#fff' : '#94a3b8',
                      background: isActive ? 'rgba(99, 102, 241, 0.16)' : 'transparent',
                      border: isActive ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
                      textDecoration: 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* User Profile & Sign Out Footer */}
          <div style={{
            paddingTop: 16,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          }}>
            <div style={{ padding: '0 8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  background: 'rgba(99, 102, 241, 0.2)',
                  color: '#a5b4fc',
                }}>
                  {user.role}
                </span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.email}
              </div>
            </div>

            <button
              onClick={handleLogout}
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Top Navbar */}
          <header style={{
            height: 64,
            padding: '0 32px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(15, 20, 32, 0.6)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>
              OneVue Security Control &bull; MongoDB Atlas Live
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link to="/" target="_blank" style={{ fontSize: 13, color: '#818cf8', textDecoration: 'none' }}>
                Preview Platform App ↗
              </Link>
            </div>
          </header>

          {/* Page Body */}
          <main style={{ padding: '32px', flex: 1 }}>
            {children}
          </main>
        </div>
      </div>
    );
  }

  window.AdminLayout = AdminLayout;
})();
