/* =========================================================================
   OneVue — Business Identity Dashboard
   Same workspace layout as the student dashboard: BusinessTopbar +
   BusinessSidebar + sub-page router under /app/business.
   ========================================================================= */

const { useState: busDState, useEffect: busDEffect, useMemo: busDMemo, useCallback: busDCallback } = React;
const { useLocation: busDUseLocation, useNavigate: busDUseNavigate } = ReactRouterDOM;

const BUSINESS_BASE_PATH = '/app/business';

function BusinessDashboard({ session }) {
  const BusinessTopbar = window.BusinessTopbar;
  const BusinessSidebar = window.BusinessSidebar;
  const BusinessMobileDrawer = window.BusinessMobileDrawer;
  const BusinessOverviewPage = window.BusinessOverviewPage;
  const BusinessIdentityPage = window.BusinessIdentityPage;

  const location = busDUseLocation();
  const navigate = busDUseNavigate();

  const [identityProfile, setIdentityProfile] = busDState(null);
  const [websiteConfig, setWebsiteConfig] = busDState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = busDState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = busDState(false);

  const loadIdentityProfile = busDCallback(async () => {
    try {
      const data = await window.OV.services.domainProfile.getIdentityProfile('business');
      setIdentityProfile((data && data.profile) || null);
    } catch (err) {
      console.warn('Could not load business profile:', err);
    }
  }, []);

  const loadWebsiteConfig = busDCallback(async () => {
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

  busDEffect(() => {
    loadIdentityProfile();
    loadWebsiteConfig();
  }, [loadIdentityProfile, loadWebsiteConfig]);

  const websiteProfile = busDMemo(
    () => window.OV.identityWorkspace.toWorkspaceProfile('business', identityProfile, session?.user),
    [identityProfile, session]
  );
  const cardProfile = busDMemo(
    () => window.OV.identityWorkspace.toCardProfile('business', identityProfile, session?.user),
    [identityProfile, session]
  );

  const activeNavId = busDMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes(`${BUSINESS_BASE_PATH}/profile`)) return 'profile';
    if (path.includes(`${BUSINESS_BASE_PATH}/identity`)) return 'identity';
    if (path.includes(`${BUSINESS_BASE_PATH}/visiting-card`)) return 'visiting-card';
    if (path.includes(`${BUSINESS_BASE_PATH}/analytics`)) return 'analytics';
    if (path.includes(`${BUSINESS_BASE_PATH}/website/preview`)) return 'website-preview';
    if (path.includes(`${BUSINESS_BASE_PATH}/website`)) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = busDMemo(() => {
    switch (activeNavId) {
      case 'profile': return 'My Profile';
      case 'identity': return 'Business Identity';
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
      <BusinessTopbar
        session={session}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        currentPageTitle={pageTitle}
      />

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div className="hide-mobile-nav">
          <BusinessSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeItem={activeNavId}
            onNavigate={(path) => navigate(path)}
          />
        </div>

        <BusinessMobileDrawer
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
            <BusinessOverviewPage
              session={session}
              workspaceProfile={websiteProfile}
              websiteConfig={websiteConfig}
              onNavigateSection={(path) => navigate(path)}
            />
          )}
          {activeNavId === 'identity' && (
            <BusinessIdentityPage onSaved={setIdentityProfile} />
          )}
          {activeNavId === 'visiting-card' && window.StudentVisitingCardPage && (
            <window.StudentVisitingCardPage
              session={session}
              studentProfile={cardProfile}
              basePath={BUSINESS_BASE_PATH}
            />
          )}
          {activeNavId === 'analytics' && window.StudentAnalyticsPage && (
            <window.StudentAnalyticsPage session={session} />
          )}
          {activeNavId === 'website-preview' && window.StudentWebsiteFullPreviewPage && (
            <window.StudentWebsiteFullPreviewPage
              session={session}
              studentProfile={websiteProfile}
              basePath={BUSINESS_BASE_PATH}
            />
          )}
          {activeNavId === 'website' && window.StudentWebsitePage && (
            <window.StudentWebsitePage
              session={session}
              studentProfile={websiteProfile}
              basePath={BUSINESS_BASE_PATH}
            />
          )}
        </main>
      </div>
    </div>
  );
}

window.BusinessDashboard = BusinessDashboard;
