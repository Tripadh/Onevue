/* OneVue — Business workspace navigation (topbar, sidebar, mobile drawer). */
/* Hooks and Router bindings */
const { useState: busNavUseState, useEffect: busNavUseEffect, useMemo: busNavUseMemo, useRef: busNavUseRef, useCallback: busNavUseCallback } = React;
const { useLocation: busNavUseLocation, useNavigate: busNavUseNavigate, Link: busNavLink } = ReactRouterDOM;
const BusinessNavIcons = window.StudentIcons || {};

/* ---------------- Topbar Component ---------------- */
function BusinessTopbar({
  session,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileDrawer,
  currentPageTitle,
}) {
  const navigate = busNavUseNavigate();
  const toast = useToast();
  const [accountMenuOpen, setAccountMenuOpen] = busNavUseState(false);
  const [searchQuery, setSearchQuery] = busNavUseState('');
  const menuRef = busNavUseRef(null);

  busNavUseEffect(() => {
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, []);

  const handleSignOut = async () => {
    try {
      await window.OV.services.auth.signOut();
      toast.push({ title: 'Signed out', body: 'Session terminated safely.', tone: 'info' });
      navigate('/');
    } catch {
      navigate('/');
    }
  };

  const initials = (session?.user?.name || 'Business')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      className="student-topbar glass"
      style={{
        height: 64,
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        borderBottom: '1px solid var(--line)',
        borderRadius: 0,
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Left: Sidebar Toggle + Brand + Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          className="icon-btn show-mobile-nav"
          onClick={onOpenMobileDrawer}
          aria-label="Open navigation menu"
          style={{ width: 36, height: 36 }}
        >
          <Icon.menu />
        </button>

        <button
          className="icon-btn hide-mobile-nav"
          onClick={onToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ width: 36, height: 36 }}
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? <BusinessNavIcons.collapseRight /> : <BusinessNavIcons.collapseLeft />}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand-mark" style={{ width: 22, height: 22 }}>
            <span />
          </div>
          <span className="brand-word serif" style={{ fontSize: 21, fontWeight: 600 }}>
            OneVue
          </span>
        </div>

        <div className="hide-mobile-nav" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
          <span className="faint" style={{ fontSize: 13 }}>/</span>
          <span className="badge" style={{ fontSize: 11, padding: '0 8px', height: 22, background: 'color-mix(in oklab, var(--accent) 12%, transparent)' }}>
            Business
          </span>
          <span className="faint" style={{ fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>
            {currentPageTitle}
          </span>
        </div>
      </div>

      {/* Center: Search */}
      <div
        className="student-search-container hide-mobile-nav"
        style={{ flex: '0 1 320px', position: 'relative' }}
      >
        <span
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-3)',
            pointerEvents: 'none',
          }}
        >
          <BusinessNavIcons.search />
        </span>
        <input
          type="search"
          className="input"
          placeholder="Search products, services, team..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            height: 38,
            paddingLeft: 36,
            paddingRight: 14,
            fontSize: 13,
            borderRadius: 999,
            background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
          }}
        />
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="icon-btn"
          aria-label="Notifications"
          title="Notifications (All caught up)"
          style={{ width: 36, height: 36, position: 'relative' }}
          onClick={() => toast.push({ title: 'Notifications', body: 'No pending alerts.', tone: 'info' })}
        >
          <BusinessNavIcons.bell />
        </button>

        <ThemePill />

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => setAccountMenuOpen(!accountMenuOpen)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '2px 4px',
              borderRadius: 999,
            }}
            aria-expanded={accountMenuOpen}
            aria-haspopup="true"
            aria-label="Account menu"
          >
            <Avatar initials={initials} src={session?.user?.profilePhotoUrl} size={34} ring />
            <span className="hide-mobile-nav" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>
              {session?.user?.name || 'Business'}
            </span>
          </button>

          {accountMenuOpen && (
            <div
              className="glass"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 10px)',
                width: 250,
                padding: '12px',
                borderRadius: 18,
                display: 'grid',
                gap: 8,
                zIndex: 60,
                boxShadow: '0 16px 36px -10px var(--shade)',
                border: '1px solid var(--line-hi)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px 10px', borderBottom: '1px solid var(--line)' }}>
                <Avatar initials={initials} src={session?.user?.profilePhotoUrl} size={38} ring />
                <div style={{ overflow: 'hidden' }}>
                  <strong style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {session?.user?.name || 'Business'}
                  </strong>
                  <span className="faint" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {session?.user?.email}
                  </span>
                </div>
              </div>

              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  navigate('/app/business/profile');
                }}
              >
                <BusinessNavIcons.profile style={{ marginRight: 8 }} />
                My Profile
              </button>

              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  navigate('/app/business/identity');
                }}
              >
                <BusinessNavIcons.identity style={{ marginRight: 8 }} />
                Edit Business Identity
              </button>

              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  navigate('/app/business/website');
                }}
              >
                <BusinessNavIcons.website style={{ marginRight: 8 }} />
                Website Settings
              </button>

              <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />

              <button
                className="btn btn-ghost danger"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px', color: '#ef4444' }}
                onClick={handleSignOut}
              >
                <BusinessNavIcons.logout style={{ marginRight: 8 }} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------------- Sidebar Navigation Links ---------------- */
const BUSINESS_NAV_ITEMS = [
  { id: 'overview', path: '/app/business', label: 'Overview', icon: BusinessNavIcons.overview },
  { id: 'identity', path: '/app/business/identity', label: 'Identity', icon: BusinessNavIcons.identity },
  { id: 'visiting-card', path: '/app/business/visiting-card/overview', label: 'Visiting Card', icon: BusinessNavIcons.card },
  { id: 'analytics', path: '/app/business/analytics', label: 'Analytics', icon: BusinessNavIcons.analytics },
  { id: 'website', path: '/app/business/website', label: 'My Website', icon: BusinessNavIcons.website },
];

/* ---------------- Sidebar Component ---------------- */
function BusinessSidebar({ isCollapsed, onToggleCollapse, activeItem, onNavigate }) {
  return (
    <aside
      className={'student-sidebar glass ' + (isCollapsed ? 'is-collapsed' : '')}
      style={{
        width: isCollapsed ? 72 : 240,
        height: 'calc(100vh - 64px)',
        position: 'sticky',
        top: 64,
        borderRight: '1px solid var(--line)',
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: isCollapsed ? '16px 8px' : '20px 14px',
        transition: 'width .28s cubic-bezier(.2,.8,.2,1), padding .28s',
        zIndex: 30,
        flexShrink: 0,
      }}
    >
      {!isCollapsed && (
        <span
          className="eyebrow"
          style={{
            fontSize: 11,
            letterSpacing: '.14em',
            color: 'var(--text-3)',
            marginBottom: 12,
            paddingLeft: 10,
          }}
        >
          Business Workspace
        </span>
      )}

      <nav style={{ display: 'grid', gap: 6 }}>
        {BUSINESS_NAV_ITEMS.map((item) => {
          const isActive = activeItem === item.id;
          const IconComp = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.path)}
              className={'student-nav-btn ' + (isActive ? 'is-active' : '')}
              title={isCollapsed ? item.label : undefined}
              aria-label={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                height: 42,
                padding: isCollapsed ? '0 16px' : '0 14px',
                borderRadius: 12,
                border: '1px solid transparent',
                background: isActive
                  ? 'color-mix(in oklab, var(--primary) 18%, var(--glass))'
                  : 'transparent',
                borderColor: isActive ? 'color-mix(in oklab, var(--primary) 35%, transparent)' : 'transparent',
                color: isActive ? 'var(--text-1)' : 'var(--text-2)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                transition: 'all .2s ease',
                position: 'relative',
              }}
            >
              <span style={{ color: isActive ? 'var(--accent)' : 'inherit', display: 'grid', placeItems: 'center' }}>
                <IconComp />
              </span>
              {!isCollapsed && <span>{item.label}</span>}
              {isActive && !isCollapsed && (
                <span
                  style={{
                    marginLeft: 'auto',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        {!isCollapsed ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'color-mix(in oklab, var(--glass) 80%, transparent)',
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>OneVue Business</span>
              <span className="serif" style={{ fontSize: 13, color: 'var(--text-3)' }}>V</span>
            </div>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.4 }}>
              Partner-ready verified organization profile
            </p>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <span className="serif" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 600 }}>V</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ---------------- Mobile Navigation Drawer ---------------- */
function BusinessMobileDrawer({ isOpen, onClose, activeItem, onNavigate }) {
  if (!isOpen) return null;
  return (
    <div className="scrim" onClick={onClose} style={{ zIndex: 99 }}>
      <div
        className="drawer glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 280,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="brand-mark" style={{ width: 22, height: 22 }}><span /></div>
            <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>OneVue Business</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close menu" style={{ width: 34, height: 34 }}>
            <Icon.x />
          </button>
        </div>

        <nav style={{ display: 'grid', gap: 8 }}>
          {BUSINESS_NAV_ITEMS.map((item) => {
            const isActive = activeItem === item.id;
            const IconComp = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.path);
                  onClose();
                }}
                className={'student-nav-btn ' + (isActive ? 'is-active' : '')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  height: 46,
                  padding: '0 16px',
                  borderRadius: 14,
                  border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                  background: isActive ? 'color-mix(in oklab, var(--accent) 15%, var(--glass))' : 'transparent',
                  color: 'var(--text-1)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 15,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: isActive ? 'var(--accent)' : 'var(--text-2)' }}>
                  <IconComp />
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

window.BusinessTopbar = BusinessTopbar;
window.BusinessSidebar = BusinessSidebar;
window.BusinessMobileDrawer = BusinessMobileDrawer;
