/* =========================================================================
   OneVue — Professional Identity Dashboard
   Same workspace layout as the student dashboard: ProfessionalTopbar +
   ProfessionalSidebar + sub-page router under /app/professional.
   ========================================================================= */

const { useState: proDState, useEffect: proDEffect, useMemo: proDMemo, useCallback: proDCallback } = React;
const { useLocation: proDUseLocation, useNavigate: proDUseNavigate } = ReactRouterDOM;

const PROFESSIONAL_BASE_PATH = '/app/professional';

function ProfessionalDashboard({ session }) {
  const ProfessionalTopbar = window.ProfessionalTopbar;
  const ProfessionalSidebar = window.ProfessionalSidebar;
  const ProfessionalMobileDrawer = window.ProfessionalMobileDrawer;
  const ProfessionalOverviewPage = window.ProfessionalOverviewPage;
  const ProfessionalIdentityPage = window.ProfessionalIdentityPage;

  const location = proDUseLocation();
  const navigate = proDUseNavigate();

  const [identityProfile, setIdentityProfile] = proDState(null);
  const [websiteConfig, setWebsiteConfig] = proDState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = proDState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = proDState(false);

  const loadIdentityProfile = proDCallback(async () => {
    try {
      const data = await window.OV.services.domainProfile.getIdentityProfile('professional');
      setIdentityProfile((data && data.profile) || null);
    } catch (err) {
      console.warn('Could not load professional profile:', err);
    }
  }, []);

  const loadWebsiteConfig = proDCallback(async () => {
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

  proDEffect(() => {
    loadIdentityProfile();
    loadWebsiteConfig();
  }, [loadIdentityProfile, loadWebsiteConfig]);

  const websiteProfile = proDMemo(
    () => window.OV.identityWorkspace.toWorkspaceProfile('professional', identityProfile, session?.user),
    [identityProfile, session]
  );
  const cardProfile = proDMemo(
    () => window.OV.identityWorkspace.toCardProfile('professional', identityProfile, session?.user),
    [identityProfile, session]
  );

  const activeNavId = proDMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/profile`)) return 'profile';
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/identity`)) return 'identity';
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/visiting-card`)) return 'visiting-card';
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/analytics`)) return 'analytics';
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/website/preview`)) return 'website-preview';
    if (path.includes(`${PROFESSIONAL_BASE_PATH}/website`)) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = proDMemo(() => {
    switch (activeNavId) {
      case 'profile': return 'My Profile';
      case 'identity': return 'Professional Identity';
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
      <ProfessionalTopbar
        session={session}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        currentPageTitle={pageTitle}
      />

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div className="hide-mobile-nav">
          <ProfessionalSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeItem={activeNavId}
            onNavigate={(path) => navigate(path)}
          />
        </div>

        <ProfessionalMobileDrawer
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
            <ProfessionalOverviewPage
              session={session}
              workspaceProfile={websiteProfile}
              websiteConfig={websiteConfig}
              onNavigateSection={(path) => navigate(path)}
            />
          )}
          {activeNavId === 'identity' && (
            <ProfessionalIdentityPage session={session} onSaved={setIdentityProfile} />
          )}
          {activeNavId === 'visiting-card' && window.StudentVisitingCardPage && (
            <window.StudentVisitingCardPage
              session={session}
              studentProfile={cardProfile}
              basePath={PROFESSIONAL_BASE_PATH}
            />
          )}
          {activeNavId === 'analytics' && window.StudentAnalyticsPage && (
            <window.StudentAnalyticsPage session={session} />
          )}
          {activeNavId === 'website-preview' && window.StudentWebsiteFullPreviewPage && (
            <window.StudentWebsiteFullPreviewPage
              session={session}
              studentProfile={websiteProfile}
              basePath={PROFESSIONAL_BASE_PATH}
            />
          )}
          {activeNavId === 'website' && window.StudentWebsitePage && (
            <window.StudentWebsitePage
              session={session}
              studentProfile={websiteProfile}
              basePath={PROFESSIONAL_BASE_PATH}
            />
          )}
        </main>
      </div>
    </div>
  );
}

window.ProfessionalDashboard = ProfessionalDashboard;
