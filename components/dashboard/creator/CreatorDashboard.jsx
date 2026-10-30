/* =========================================================================
   OneVue — Creator Identity Dashboard
   Same workspace layout as the student dashboard: CreatorTopbar +
   CreatorSidebar + sub-page router under /app/creator.
   ========================================================================= */

const { useState: creDState, useEffect: creDEffect, useMemo: creDMemo, useCallback: creDCallback } = React;
const { useLocation: creDUseLocation, useNavigate: creDUseNavigate } = ReactRouterDOM;

const CREATOR_BASE_PATH = '/app/creator';

function CreatorDashboard({ session }) {
  const CreatorTopbar = window.CreatorTopbar;
  const CreatorSidebar = window.CreatorSidebar;
  const CreatorMobileDrawer = window.CreatorMobileDrawer;
  const CreatorOverviewPage = window.CreatorOverviewPage;
  const CreatorIdentityPage = window.CreatorIdentityPage;

  const location = creDUseLocation();
  const navigate = creDUseNavigate();

  const [identityProfile, setIdentityProfile] = creDState(null);
  const [websiteConfig, setWebsiteConfig] = creDState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = creDState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = creDState(false);

  const loadIdentityProfile = creDCallback(async () => {
    try {
      const data = await window.OV.services.domainProfile.getIdentityProfile('creator');
      setIdentityProfile((data && data.profile) || null);
    } catch (err) {
      console.warn('Could not load creator profile:', err);
    }
  }, []);

  const loadWebsiteConfig = creDCallback(async () => {
    const token = session?.token || window.OV?.core?.db?.get('session')?.token;
    if (!token) return;
    try {
      const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
      const res = await fetch(`${apiBase}/student/website/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWebsiteConfig((data && data.config) || null);
      }
    } catch (err) {
      console.warn('Could not load website configuration:', err);
    }
  }, [session]);

  creDEffect(() => {
    loadIdentityProfile();
    loadWebsiteConfig();
  }, [loadIdentityProfile, loadWebsiteConfig]);

  const websiteProfile = creDMemo(
    () => window.OV.identityWorkspace.toWorkspaceProfile('creator', identityProfile, session?.user),
    [identityProfile, session]
  );
  const cardProfile = creDMemo(
    () => window.OV.identityWorkspace.toCardProfile('creator', identityProfile, session?.user),
    [identityProfile, session]
  );

  const activeNavId = creDMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes(`${CREATOR_BASE_PATH}/profile`)) return 'profile';
    if (path.includes(`${CREATOR_BASE_PATH}/identity`)) return 'identity';
    if (path.includes(`${CREATOR_BASE_PATH}/visiting-card`)) return 'visiting-card';
    if (path.includes(`${CREATOR_BASE_PATH}/analytics`)) return 'analytics';
    if (path.includes(`${CREATOR_BASE_PATH}/website/preview`)) return 'website-preview';
    if (path.includes(`${CREATOR_BASE_PATH}/website`)) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = creDMemo(() => {
    switch (activeNavId) {
      case 'profile': return 'My Profile';
      case 'identity': return 'Creator Identity';
      case 'visiting-card': {
        const sub = location.pathname.toLowerCase();
        if (sub.includes('/templates')) return 'Card Templates';
        if (sub.includes('/studio')) return 'Visiting Card Studio';
        return 'Visiting Cards';
      }
      case 'analytics': return 'Analytics';
      case 'website-preview': return 'Website Preview';
      case 'website': return 'My Website';
      default: return 'Overview';
    }
  }, [activeNavId, location.pathname]);

  return (
    <div className="student-dashboard-root" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <CreatorTopbar
        session={session}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        currentPageTitle={pageTitle}
      />

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div className="hide-mobile-nav">
          <CreatorSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeItem={activeNavId}
            onNavigate={(path) => navigate(path)}
          />
        </div>

        <CreatorMobileDrawer
          isOpen={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          activeItem={activeNavId}
          onNavigate={(path) => navigate(path)}
        />

        <main
          id="main"
          style={{
            flex: 1,
            padding: '32px 36px 80px',
            maxWidth: 1200,
            width: '100%',
            margin: '0 auto',
            overflowX: 'hidden',
          }}
        >
          {activeNavId === 'profile' && window.StudentProfilePage && (
            <window.StudentProfilePage session={session} />
          )}
          {activeNavId === 'overview' && (
            <CreatorOverviewPage
              session={session}
              workspaceProfile={websiteProfile}
              websiteConfig={websiteConfig}
              onNavigateSection={(path) => navigate(path)}
            />
          )}
          {activeNavId === 'identity' && (
            <CreatorIdentityPage onSaved={setIdentityProfile} />
          )}
          {activeNavId === 'visiting-card' && window.StudentVisitingCardPage && (
            <window.StudentVisitingCardPage
              session={session}
              studentProfile={cardProfile}
              basePath={CREATOR_BASE_PATH}
            />
          )}
          {activeNavId === 'analytics' && window.StudentAnalyticsPage && (
            <window.StudentAnalyticsPage session={session} />
          )}
          {activeNavId === 'website-preview' && window.StudentWebsiteFullPreviewPage && (
            <window.StudentWebsiteFullPreviewPage
              session={session}
              studentProfile={websiteProfile}
              basePath={CREATOR_BASE_PATH}
            />
          )}
          {activeNavId === 'website' && window.StudentWebsitePage && (
            <window.StudentWebsitePage
              session={session}
              studentProfile={websiteProfile}
              basePath={CREATOR_BASE_PATH}
            />
          )}
        </main>
      </div>
    </div>
  );
}

window.CreatorDashboard = CreatorDashboard;
