/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
const StudentIcons = window.StudentIcons || {};

/* ---------------- Topbar Component ---------------- */
function StudentTopbar({
  session,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileDrawer,
  currentPageTitle,
}) {
  const navigate = sUseNavigate();
  const toast = useToast();
  const [accountMenuOpen, setAccountMenuOpen] = sUseState(false);
  const [searchQuery, setSearchQuery] = sUseState('');
  const menuRef = sUseRef(null);

  sUseEffect(() => {
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

  const initials = (session?.user?.name || 'Student')
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
          {isSidebarCollapsed ? <StudentIcons.collapseRight /> : <StudentIcons.collapseLeft />}
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
            Student
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
          <StudentIcons.search />
        </span>
        <input
          type="search"
          className="input"
          placeholder="Search courses, projects, skills..."
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
          <StudentIcons.bell />
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
          >
            <Avatar initials={initials} size={34} ring />
            <span className="hide-mobile-nav" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>
              {session?.user?.name || 'Student'}
            </span>
          </button>

          {accountMenuOpen && (
            <div
              className="glass"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 10px)',
                width: 240,
                padding: '12px',
                borderRadius: 18,
                display: 'grid',
                gap: 8,
                zIndex: 60,
                boxShadow: '0 16px 36px -10px var(--shade)',
                border: '1px solid var(--line-hi)',
              }}
            >
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                <strong style={{ display: 'block', fontSize: 14 }}>{session?.user?.name}</strong>
                <span className="faint" style={{ fontSize: 12 }}>{session?.user?.email}</span>
              </div>

              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  navigate('/app/student/identity');
                }}
              >
                <StudentIcons.identity style={{ marginRight: 8 }} />
                Edit Academic Identity
              </button>

              <button
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px' }}
                onClick={() => {
                  setAccountMenuOpen(false);
                  navigate('/app/student/website');
                }}
              >
                <StudentIcons.website style={{ marginRight: 8 }} />
                Website Settings
              </button>

              <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />

              <button
                className="btn btn-ghost danger"
                style={{ justifyContent: 'flex-start', fontSize: 13, height: 36, padding: '0 8px', color: '#ef4444' }}
                onClick={handleSignOut}
              >
                <StudentIcons.logout style={{ marginRight: 8 }} />
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
const STUDENT_NAV_ITEMS = [
  { id: 'overview', path: '/app/student', label: 'Overview', icon: StudentIcons.overview },
  { id: 'identity', path: '/app/student/identity', label: 'Identity', icon: StudentIcons.identity },
  { id: 'visiting-card', path: '/app/student/visiting-card', label: 'Visiting Card', icon: StudentIcons.card },
  { id: 'analytics', path: '/app/student/analytics', label: 'Analytics', icon: StudentIcons.analytics },
  { id: 'website', path: '/app/student/website', label: 'My Website', icon: StudentIcons.website },
];

/* ---------------- Sidebar Component ---------------- */
function StudentSidebar({ isCollapsed, onToggleCollapse, activeItem, onNavigate }) {
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
          Student Workspace
        </span>
      )}

      <nav style={{ display: 'grid', gap: 6 }}>
        {STUDENT_NAV_ITEMS.map((item) => {
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
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>OneVue Academic</span>
              <span className="serif" style={{ fontSize: 13, color: 'var(--text-3)' }}>I</span>
            </div>
            <p className="faint" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.4 }}>
              Admissions & internships verified profile
            </p>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <span className="serif" style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 600 }}>I</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ---------------- Mobile Navigation Drawer ---------------- */
function StudentMobileDrawer({ isOpen, onClose, activeItem, onNavigate }) {
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
            <span className="serif" style={{ fontSize: 22, fontWeight: 600 }}>OneVue Student</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close menu" style={{ width: 34, height: 34 }}>
            <Icon.x />
          </button>
        </div>

        <nav style={{ display: 'grid', gap: 8 }}>
          {STUDENT_NAV_ITEMS.map((item) => {
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

window.StudentTopbar = StudentTopbar;
window.StudentSidebar = StudentSidebar;
window.StudentMobileDrawer = StudentMobileDrawer;
