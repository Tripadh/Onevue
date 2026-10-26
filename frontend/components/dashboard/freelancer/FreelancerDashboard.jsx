/* =========================================================================
   OneVue — Freelancer Identity Dashboard
   Same workspace layout as the student dashboard: FreelancerTopbar +
   FreelancerSidebar + sub-page router under /app/freelancer.
   ========================================================================= */

const { useState: freeDState, useEffect: freeDEffect, useMemo: freeDMemo, useCallback: freeDCallback } = React;
const { useLocation: freeDUseLocation, useNavigate: freeDUseNavigate } = ReactRouterDOM;

const FREELANCER_BASE_PATH = '/app/freelancer';

function FreelancerDashboard({ session }) {
  const FreelancerTopbar = window.FreelancerTopbar;
  const FreelancerSidebar = window.FreelancerSidebar;
  const FreelancerMobileDrawer = window.FreelancerMobileDrawer;
  const FreelancerOverviewPage = window.FreelancerOverviewPage;
  const FreelancerIdentityPage = window.FreelancerIdentityPage;

  const location = freeDUseLocation();
  const navigate = freeDUseNavigate();

  const [identityProfile, setIdentityProfile] = freeDState(null);
  const [websiteConfig, setWebsiteConfig] = freeDState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = freeDState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = freeDState(false);

  const loadIdentityProfile = freeDCallback(async () => {
    try {
      const data = await window.OV.services.domainProfile.getIdentityProfile('freelancer');
      setIdentityProfile((data && data.profile) || null);
    } catch (err) {
      console.warn('Could not load freelancer profile:', err);
    }
  }, []);

  const loadWebsiteConfig = freeDCallback(async () => {
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

  freeDEffect(() => {
    loadIdentityProfile();
    loadWebsiteConfig();
  }, [loadIdentityProfile, loadWebsiteConfig]);

  const websiteProfile = freeDMemo(
    () => window.OV.identityWorkspace.toWorkspaceProfile('freelancer', identityProfile, session?.user),
    [identityProfile, session]
  );
  const cardProfile = freeDMemo(
    () => window.OV.identityWorkspace.toCardProfile('freelancer', identityProfile, session?.user),
    [identityProfile, session]
  );

  const activeNavId = freeDMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes(`${FREELANCER_BASE_PATH}/profile`)) return 'profile';
    if (path.includes(`${FREELANCER_BASE_PATH}/identity`)) return 'identity';
    if (path.includes(`${FREELANCER_BASE_PATH}/visiting-card`)) return 'visiting-card';
    if (path.includes(`${FREELANCER_BASE_PATH}/analytics`)) return 'analytics';
    if (path.includes(`${FREELANCER_BASE_PATH}/website/preview`)) return 'website-preview';
    if (path.includes(`${FREELANCER_BASE_PATH}/website`)) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = freeDMemo(() => {
    switch (activeNavId) {
      case 'profile': return 'My Profile';
      case 'identity': return 'Freelancer Identity';
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
      <FreelancerTopbar
        session={session}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        currentPageTitle={pageTitle}
      />

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div className="hide-mobile-nav">
          <FreelancerSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeItem={activeNavId}
            onNavigate={(path) => navigate(path)}
          />
        </div>

        <FreelancerMobileDrawer
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
            <FreelancerOverviewPage
              session={session}
              workspaceProfile={websiteProfile}
              websiteConfig={websiteConfig}
              onNavigateSection={(path) => navigate(path)}
            />
          )}
          {activeNavId === 'identity' && (
            <FreelancerIdentityPage session={session} onSaved={setIdentityProfile} />
          )}
          {activeNavId === 'visiting-card' && window.StudentVisitingCardPage && (
            <window.StudentVisitingCardPage
              session={session}
              studentProfile={cardProfile}
              basePath={FREELANCER_BASE_PATH}
            />
          )}
          {activeNavId === 'analytics' && window.StudentAnalyticsPage && (
            <window.StudentAnalyticsPage session={session} />
          )}
          {activeNavId === 'website-preview' && window.StudentWebsiteFullPreviewPage && (
            <window.StudentWebsiteFullPreviewPage
              session={session}
              studentProfile={websiteProfile}
              basePath={FREELANCER_BASE_PATH}
            />
          )}
          {activeNavId === 'website' && window.StudentWebsitePage && (
            <window.StudentWebsitePage
              session={session}
              studentProfile={websiteProfile}
              basePath={FREELANCER_BASE_PATH}
            />
          )}
        </main>
      </div>
    </div>
  );
}

window.FreelancerDashboard = FreelancerDashboard;
