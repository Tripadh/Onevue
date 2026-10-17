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
  const [profileError, setProfileError] = sUseState('');
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || !data.profile) {
        setProfileError(data.message || 'Your student profile could not be loaded. Try again to create it for this account.');
        return;
      }
      setProfileError('');
      setStudentProfile(data.profile);
    } catch (err) {
      setProfileError('Could not load your student profile. Check that you are signed in and try again.');
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
      const outcome = window.OV.services.credentials.profileSaveFeedback({
        ok: res.ok,
        message: data && data.message,
        profile: data && data.profile,
      });
      if (!outcome.ok) {
        toast.push({ title: outcome.title, body: outcome.body, tone: 'error' });
        return false;
      }
      if (outcome.profile) {
        setStudentProfile(outcome.profile);
      }
      toast.push({ title: outcome.title, body: outcome.body, tone: 'success' });
      return outcome.profile || true;
    } catch (err) {
      toast.push({ title: 'Network Error', body: 'Could not connect to database backend.', tone: 'error' });
      return false;
    }
  };

  // Derive active navigation id
  const activeNavId = sUseMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes('/app/student/identity')) return 'identity';
    if (path.includes('/app/student/visiting-card')) return 'visiting-card';
    if (path.includes('/app/student/analytics')) return 'analytics';
    if (path.includes('/app/student/website/preview')) return 'website-preview';
    if (path.includes('/app/student/website')) return 'website';
    return 'overview';
  }, [location.pathname]);

  const pageTitle = sUseMemo(() => {
    switch (activeNavId) {
      case 'identity': return 'Student Identity';
      case 'visiting-card': return 'Visiting Card';
      case 'analytics': return 'Analytics';
      case 'website-preview': return 'Website Preview';
      case 'website': return 'My Website';
      default: return 'Overview';
    }
  }, [activeNavId]);

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
              profileError={profileError}
              onRetryProfile={fetchStudentProfile}
              onRefreshProfile={fetchStudentProfile}
              onSaveToDb={saveStudentProfileToDb}
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
