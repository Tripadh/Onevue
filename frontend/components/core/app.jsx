/* App shell + routes. Landing at "/", public profile at "/:username" and "/:username/:onevue". */
const { useState: apUseState, useEffect: apUseEffect } = React;
const { HashRouter, Routes, Route, useParams, useNavigate, Link, Navigate } = ReactRouterDOM;
const SP = window.OV.services;

/* ---------------- Centralized Route Resolver ---------------- */
const DASHBOARD_ROUTES = {
  student: '/app/student',
  professional: '/app/professional',
  freelancer: '/app/freelancer',
  creator: '/app/creator',
  business: '/app/business',
};

function resolveDashboardRoute(identity) {
  const id = String(identity || '').trim().toLowerCase();
  return DASHBOARD_ROUTES[id] || '/app/professional';
}

/* ---------------- Route Guard ---------------- */
function ProtectedDashboardRoute({ expectedRole }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [checking, setChecking] = apUseState(true);

  apUseEffect(() => {
    // 1. Unauthenticated users cannot access protected dashboard routes
    if (!session) {
      toast.push({ title: 'Access Denied', body: 'Please sign in to access your dashboard.', tone: 'info' });
      navigate('/');
      return;
    }

    // 2. If user hasn't selected their identity yet, route to identity selection
    if (!session.user?.identity) {
      navigate('/onboarding/identity', { replace: true });
      return;
    }

    // 3. If user hasn't completed the discovery survey, route to the survey page
    if (!session.user?.onboarding?.surveyCompleted) {
      navigate('/onboarding/survey', { replace: true });
      return;
    }

    // 4. Authoritative check: User cannot access other roles' dashboards
    const userRole = session.user.identity.toLowerCase();
    if (userRole !== expectedRole) {
      toast.push({
        title: 'Access Restricted',
        body: `You are signed in as a ${userRole}. Redirected to your dashboard.`,
        tone: 'info',
      });
      navigate(resolveDashboardRoute(userRole), { replace: true });
      return;
    }

    setChecking(false);
  }, [session, expectedRole, navigate]);

  if (checking || !session) {
    return (
      <main id="main" className="wrap" style={{ paddingTop: 120, minHeight: '80vh', display: 'grid', placeItems: 'center' }}>
        <GlassCard style={{ padding: 40, textAlign: 'center', maxWidth: 400 }}>
          <div className="spin" style={{ margin: '0 auto 16px', width: 28, height: 28 }} />
          <h3 className="h-card" style={{ fontSize: 20 }}>Verifying credentials...</h3>
          <p className="muted" style={{ fontSize: 14 }}>Connecting to your secure {expectedRole} dashboard.</p>
        </GlassCard>
      </main>
    );
  }

  // Render the identity-specific dashboard component from its dedicated module
  switch (expectedRole) {
    case 'student':
      return window.StudentDashboard ? <window.StudentDashboard session={session} /> : null;
    case 'professional':
      return window.ProfessionalDashboard ? <window.ProfessionalDashboard session={session} /> : null;
    case 'freelancer':
      return window.FreelancerDashboard ? <window.FreelancerDashboard session={session} /> : null;
    case 'creator':
      return window.CreatorDashboard ? <window.CreatorDashboard session={session} /> : null;
    case 'business':
      return window.BusinessDashboard ? <window.BusinessDashboard session={session} /> : null;
    default:
      return window.ProfessionalDashboard ? <window.ProfessionalDashboard session={session} /> : null;
  }
}

/* ---------------- Automatic Redirect Route (/dashboard) ---------------- */
function DashboardRedirect() {
  const session = useSession();
  const navigate = useNavigate();

  apUseEffect(() => {
    if (!session) {
      navigate('/');
    } else if (!session.user?.identity) {
      navigate('/onboarding/identity', { replace: true });
    } else if (!session.user?.onboarding?.surveyCompleted) {
      navigate('/onboarding/survey', { replace: true });
    } else {
      const destination = resolveDashboardRoute(session.user.identity);
      navigate(destination, { replace: true });
    }
  }, [session, navigate]);

  return null;
}

function OAuthRedirectHandler() {
  const navigate = useNavigate();
  const toast = useToast();
  const handled = React.useRef(false);

  apUseEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('oauth');
    if (!status) return;

    if (status === 'error') {
      const reason = params.get('reason');
      window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.hash);
      const failureMessages = {
        google_callback_google_code_exchange: 'Google rejected the callback. Check that the configured callback URL matches Google OAuth settings.',
        google_callback_google_identity_verification: 'The Google account response could not be verified. Please try again.',
        google_callback_database_connection: 'The backend could not connect to the account database.',
        google_callback_account_lookup: 'The backend could not look up the Google account.',
        google_callback_account_conflict: 'An account already uses this email. Sign in with that account, then link Google from account settings.',
        google_callback_account_creation: 'The account could not be created. If this email already has an account, sign in and link Google from account settings.',
        google_callback_account_linking: 'The Google account could not be linked.',
        google_callback_session_creation: 'Google was verified, but the backend could not create your session.',
        google_callback_state_validation: 'The sign-in request expired or could not be verified. Start Google sign-in again.',
        google_callback_google_configuration: 'Google sign-in is not configured correctly on the backend.',
      };
      const failureMessage = Object.prototype.hasOwnProperty.call(failureMessages, reason)
        ? failureMessages[reason]
        : 'Please try again. Check the backend log for a safe failure-stage diagnostic.';
      toast.push({
        title: 'Google sign-in failed',
        body: failureMessage,
        tone: 'error',
      });
      return;
    }
    if (status !== 'success' || handled.current) return;
    handled.current = true;

    window.OV.services.auth.waitForSessionRestore().then((restoredSession) => {
      window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.hash);
      if (!restoredSession) {
        toast.push({ title: 'Could not restore your session', body: 'Please sign in again.', tone: 'error' });
        return;
      }

      if (!restoredSession.user?.identity) {
        navigate('/onboarding/identity', { replace: true });
      } else if (!restoredSession.user?.onboarding?.surveyCompleted) {
        navigate('/onboarding/survey', { replace: true });
      } else {
        navigate(resolveDashboardRoute(restoredSession.user.identity), { replace: true });
      }
    }).catch(() => {
      window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.hash);
      toast.push({ title: 'Could not restore your session', body: 'Please sign in again.', tone: 'error' });
    });
  }, [navigate, toast]);

  return null;
}

// Attach helpers to window for other components
Object.assign(window, {
  DASHBOARD_ROUTES,
  resolveDashboardRoute,
  ProtectedDashboardRoute,
  DashboardRedirect,
});

function Landing() {
  const [onevue, setOnevue] = apUseState('recruiter');
  apUseEffect(() => { SP.analytics.track('landing_view'); }, []);
  const onPickOnevue = (label) => {
    const id = label.toLowerCase();
    if (['recruiter', 'client', 'college'].includes(id)) { setOnevue(id); scrollToId('views'); }
    else window.location.hash = '#/amara/' + id;
  };
  return (
    <main id="main">
      <Hero onPickOnevue={onPickOnevue} />
      <Problem />
      <HowItWorks />
      <ProfileTypes />
      <AudienceDemo onevue={onevue} setOnevue={setOnevue} />
      <ThemeGallery />
      <CredentialsShowcase />
      <QRShare />
      <Testimonials />
      <Pricing />
      <FAQ />
      <ClosingCTA />
      <ThemeDock />
    </main>
  );
}

function PublicProfile() {
  const { username, onevue } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: profile, loading } = useAsync(() => SP.profile.getProfileByUsername(username), [username]);
  const { data: onevues } = useAsync(() => SP.onevues.listOnevues(), []);
  const [view, setView] = apUseState(null);
  const active = onevue || 'recruiter';
  apUseEffect(() => { window.scrollTo(0, 0); }, [username]);
  apUseEffect(() => {
    if (!profile) return; let alive = true;
    SP.onevues.renderOnevue(profile, active).then(v => alive && setView(v));
    SP.analytics.track('profile_view', { username, onevue: active });
    return () => { alive = false; };
  }, [profile, active]);

  if (loading) return <main id="main" className="wrap pub"><GlassCard className="pub-card"><Skeleton w={72} h={72} r={72} /><Skeleton w="40%" h={28} style={{ marginTop: 20 }} /><Skeleton h={120} style={{ marginTop: 24 }} /></GlassCard></main>;
  if (!profile) return (
    <main id="main" className="wrap pub">
      <GlassCard className="pub-card"><EmptyState title={'onevue.id/' + username + ' is unclaimed'} body="Nobody owns this name yet. It could be yours in a minute." action={<Button onClick={() => navigate('/')}>Back to Onevue</Button>} /></GlassCard>
    </main>
  );

  const empty = view && view.sections.length === 0;
  const url = SP.shares.buildUrl(profile.username, active);
  return (
    <main id="main" className="wrap pub">
      <div className="pub-bar">
        <Link to="/" className="btn btn-ghost" style={{ paddingLeft: 0 }}>← Onevue</Link>
        <Button size="sm" variant="glass" icon={<Icon.copy />} onClick={async () => { await copyText('https://' + url); toast.push({ title: 'Link copied', body: url, tone: 'success' }); }}>Copy link</Button>
      </div>
      {onevues && <div className="pub-tabs"><Tabs items={onevues.map(f => ({ value: f.id, label: f.label }))} value={active} onChange={v => navigate('/' + profile.username + '/' + v)} label="Audience view" idBase="pub" /></div>}
      <GlassCard className="pub-card" role="tabpanel" id="pub-panel" aria-labelledby={'pub-tab-' + active}>
        {view ? (empty ? <EmptyState title="Nothing shared here yet" body={profile.name + ' hasn’t added any sections to this view.'} /> : <OnevueView view={view} />) : <Skeleton h={200} />}
      </GlassCard>
      <p className="faint mono" style={{ textAlign: 'center', fontSize: 12.5, marginTop: 20 }}>{url}</p>
    </main>
  );
}

function App() {
  const location = ReactRouterDOM.useLocation();
  const isAuthRoute = ['/login', '/signup', '/forgot-password'].includes(location.pathname);
  return (
    <>
      <ToastProvider>
        <AppProvider>
          <a href="#main" className="skip" onClick={e => { e.preventDefault(); const m = document.getElementById('main'); m && m.focus && (m.tabIndex = -1, m.focus()); }}>Skip to content</a>
          <OAuthRedirectHandler />
          {!isAuthRoute && <Navbar />}
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<AuthLoginPage />} />
            <Route path="/signup" element={<AuthSignupPage />} />
            <Route path="/forgot-password" element={<AuthForgotPasswordPage />} />
            <Route path="/onboarding/identity" element={<IdentityOnboardingPage />} />
            <Route path="/onboarding/survey" element={<SurveyOnboardingPage />} />
            <Route path="/dashboard" element={<DashboardRedirect />} />
            <Route path="/app/student" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/profile" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/identity" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card" element={<Navigate to="/app/student/visiting-card/overview" replace />} />
            <Route path="/app/student/visiting-card/overview" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card/templates" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card/studio/new" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card/studio/:cardId" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card/studio" element={<Navigate to="/app/student/visiting-card/overview" replace />} />
            <Route path="/app/student/analytics" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/website" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/website/preview" element={<ProtectedDashboardRoute expectedRole="student" />} />
            {['professional', 'freelancer', 'creator', 'business'].flatMap((role) => {
              const base = `/app/${role}`;
              const dashboard = <ProtectedDashboardRoute expectedRole={role} />;
              const cardsHome = <Navigate to={`${base}/visiting-card/overview`} replace />;
              return [
                <Route key={base} path={base} element={dashboard} />,
                <Route key={`${base}/profile`} path={`${base}/profile`} element={dashboard} />,
                <Route key={`${base}/identity`} path={`${base}/identity`} element={dashboard} />,
                <Route key={`${base}/visiting-card`} path={`${base}/visiting-card`} element={cardsHome} />,
                <Route key={`${base}/visiting-card/overview`} path={`${base}/visiting-card/overview`} element={dashboard} />,
                <Route key={`${base}/visiting-card/templates`} path={`${base}/visiting-card/templates`} element={dashboard} />,
                <Route key={`${base}/visiting-card/studio/new`} path={`${base}/visiting-card/studio/new`} element={dashboard} />,
                <Route key={`${base}/visiting-card/studio/:cardId`} path={`${base}/visiting-card/studio/:cardId`} element={dashboard} />,
                <Route key={`${base}/visiting-card/studio`} path={`${base}/visiting-card/studio`} element={cardsHome} />,
                <Route key={`${base}/analytics`} path={`${base}/analytics`} element={dashboard} />,
                <Route key={`${base}/website`} path={`${base}/website`} element={dashboard} />,
                <Route key={`${base}/website/preview`} path={`${base}/website/preview`} element={dashboard} />,
              ];
            })}
            <Route path="/card/:username" element={<PublicVisitingCard />} />
            <Route path="/v/:username" element={<PublicVisitingCard />} />
            <Route path="/:username" element={<PublicProfile />} />
            <Route path="/:username/:onevue" element={<PublicProfile />} />
          </Routes>

          {!isAuthRoute && <Footer />}
        </AppProvider>
      </ToastProvider>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter><App /></HashRouter>
);
