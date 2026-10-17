/* App shell + routes. Landing at "/", public profile at "/:username" and "/:username/:onevue". */
const { useState: apUseState, useEffect: apUseEffect } = React;
const { HashRouter, Routes, Route, useParams, useNavigate, Link } = ReactRouterDOM;
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
  return (
    <HashRouter>
      <ToastProvider>
        <AppProvider>
          <a href="#main" className="skip" onClick={e => { e.preventDefault(); const m = document.getElementById('main'); m && m.focus && (m.tabIndex = -1, m.focus()); }}>Skip to content</a>
          <Navbar />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/onboarding/identity" element={<IdentityOnboardingPage />} />
            <Route path="/onboarding/survey" element={<SurveyOnboardingPage />} />
            <Route path="/dashboard" element={<DashboardRedirect />} />
            <Route path="/app/student" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/identity" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/visiting-card" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/analytics" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/website" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/student/website/preview" element={<ProtectedDashboardRoute expectedRole="student" />} />
            <Route path="/app/professional" element={<ProtectedDashboardRoute expectedRole="professional" />} />
            <Route path="/app/freelancer" element={<ProtectedDashboardRoute expectedRole="freelancer" />} />
            <Route path="/app/creator" element={<ProtectedDashboardRoute expectedRole="creator" />} />
            <Route path="/app/business" element={<ProtectedDashboardRoute expectedRole="business" />} />
            <Route path="/:username" element={<PublicProfile />} />
            <Route path="/:username/:onevue" element={<PublicProfile />} />
          </Routes>

          <Footer />
        </AppProvider>
      </ToastProvider>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
