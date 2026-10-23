/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;

/* =========================================================================
   MAIN STUDENT DASHBOARD COMPONENT
   ========================================================================= */
function StudentDashboard({ session }) {
  const StudentTopbar = window.StudentTopbar;
  const StudentSidebar = window.StudentSidebar;
  const StudentMobileDrawer = window.StudentMobileDrawer;
  const StudentOverviewPage = window.StudentOverviewPage;
  const StudentIdentityPage = window.StudentIdentityPage;
  const StudentVisitingCardPage = window.StudentVisitingCardPage;
  const StudentAnalyticsPage = window.StudentAnalyticsPage;
  const StudentWebsitePage = window.StudentWebsitePage;
  const StudentWebsiteFullPreviewPage = window.StudentWebsiteFullPreviewPage;

  const location = sUseLocation();
  const navigate = sUseNavigate();
  const toast = useToast();

  const [studentProfile, setStudentProfile] = sUseState(null);
  const [loadingProfile, setLoadingProfile] = sUseState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = sUseState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = sUseState(false);

  // Fetch real MongoDB student profile via authenticated API
  const fetchStudentProfile = sUseCallback(async () => {
    try {
      const token = session?.token || (window.OV?.core?.db?.get('session')?.token);
      if (!token) {
        setLoadingProfile(false);
        return;
      }
      const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
      const res = await fetch(`${apiBase}/student/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.profile) {
          setStudentProfile(data.profile);
        }
      }
    } catch (err) {
      console.warn('Could not load student profile from database:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, [session]);

  sUseEffect(() => {
    fetchStudentProfile();
  }, [fetchStudentProfile]);

  // Save updates directly to MongoDB
  const saveStudentProfileToDb = async (updatePayload) => {
    try {
      const token = session?.token || (window.OV?.core?.db?.get('session')?.token);
      if (!token) {
        toast.push({ title: 'Authentication missing', body: 'Please sign in to save changes.', tone: 'error' });
        return false;
      }
      const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
      const res = await fetch(`${apiBase}/student/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Failed to save', body: data.message || 'Could not save to database.', tone: 'error' });
        return false;
      }
      if (data.profile) {
        setStudentProfile(data.profile);
      }
      toast.push({ title: 'Saved to Database', body: 'Student records updated in MongoDB.', tone: 'success' });
      return true;
    } catch (err) {
      toast.push({ title: 'Network Error', body: 'Could not connect to database backend.', tone: 'error' });
      return false;
    }
  };

  // Derive active navigation id
  const activeNavId = sUseMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes('/app/student/profile')) return 'profile';
    if (path.includes('/app/student/identity')) return 'identity';
    if (path.includes('/app/student/visiting-card')) return 'visiting-card';
    if (path.includes('/app/student/analytics')) return 'analytics';
    if (path.includes('/app/student/website/preview')) return 'website-preview';
    if (path.includes('/app/student/website')) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = sUseMemo(() => {
    switch (activeNavId) {
      case 'profile': return 'My Profile';
      case 'identity': return 'Student Identity';
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
      <StudentTopbar
        session={session}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        currentPageTitle={pageTitle}
      />

      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div className="hide-mobile-nav">
          <StudentSidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            activeItem={activeNavId}
            onNavigate={(path) => navigate(path)}
          />
        </div>

        <StudentMobileDrawer
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
            <window.StudentProfilePage
              session={session}
            />
          )}
          {activeNavId === 'overview' && (
            <StudentOverviewPage
              session={session}
              studentProfile={studentProfile}
              onNavigateSection={(path) => navigate(path)}
            />
          )}
          {activeNavId === 'identity' && (
            <StudentIdentityPage
              session={session}
              studentProfile={studentProfile}
              onSaveToDb={saveStudentProfileToDb}
              onProfileReplaced={setStudentProfile}
              loadingProfile={loadingProfile}
            />
          )}
          {activeNavId === 'visiting-card' && (
            <StudentVisitingCardPage
              session={session}
              studentProfile={studentProfile}
            />
          )}
          {activeNavId === 'analytics' && (
            <StudentAnalyticsPage
              session={session}
            />
          )}
          {activeNavId === 'website-preview' && (
            <StudentWebsiteFullPreviewPage
              session={session}
              studentProfile={studentProfile}
            />
          )}
          {activeNavId === 'website' && (
            <StudentWebsitePage
              session={session}
              studentProfile={studentProfile}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// Export strictly for window consumption
window.StudentDashboard = StudentDashboard;
