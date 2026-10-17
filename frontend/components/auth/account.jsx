/* Account: shared app context, auth/claim modal, URL claimer, navbar, mobile drawer. */
const { useState: acUseState, useEffect: acUseEffect, useRef: acUseRef, createContext: acCreateContext, useContext: acUseContext } = React;
const SV = window.OV.services;

const AppCtx = acCreateContext(null);
const useApp = () => acUseContext(AppCtx);

/** Provides openAuth(mode, {username}) and the pending-username flow to the whole app. */
function AppProvider({ children }) {
  const [auth, setAuth] = acUseState({ open: false, mode: 'signup', username: '' });
  const openAuth = (mode = 'signup', opts = {}) => setAuth({ open: true, mode, username: opts.username || '' });
  const closeAuth = () => setAuth(a => ({ ...a, open: false }));
  return (
    <AppCtx.Provider value={{ openAuth, closeAuth }}>
      {children}
      <AuthModal state={auth} setState={setAuth} onClose={closeAuth} />
    </AppCtx.Provider>
  );
}

const IDENTITY_OPTIONS = [
  {
    id: 'student',
    title: 'Student',
    desc: 'For students building an academic profile, showcasing projects, listing skills, and presenting certifications.',
    glyph: 'I',
    badge: 'Academic',
  },
  {
    id: 'professional',
    title: 'Professional',
    desc: 'For working professionals presenting work experience, qualifications, career achievements, and professional skills.',
    glyph: 'II',
    badge: 'Career',
  },
  {
    id: 'freelancer',
    title: 'Freelancer',
    desc: 'For independent professionals presenting services, pricing, portfolios, and client-facing information.',
    glyph: 'III',
    badge: 'Services',
  },
  {
    id: 'creator',
    title: 'Creator',
    desc: 'For creators showcasing content, social links, featured work, and collaborations.',
    glyph: 'IV',
    badge: 'Media',
  },
  {
    id: 'business',
    title: 'Business',
    desc: 'For companies presenting their organization, services, branding, business credentials, and contact details.',
    glyph: 'V',
    badge: 'Company',
  },
];

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

/* ---------------- Auth modal (sign up / sign in / claimed) ---------------- */
function AuthModal({ state, setState, onClose }) {
  const toast = useToast();
  const session = useSession();
  const navigate = ReactRouterDOM.useNavigate();
  const [form, setForm] = acUseState({ name: '', email: '', password: '', identity: '' });
  const [err, setErr] = acUseState({});
  const [busy, setBusy] = acUseState(false);
  const [done, setDone] = acUseState(null);
  acUseEffect(() => {
    if (state.open) {
      setErr({});
      setDone(null);
      setBusy(false);
      setForm({ name: '', email: '', password: '', identity: '' });
    }
  }, [state.open, state.mode]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const isUp = state.mode === 'signup';

  async function claimIfNeeded(s) {
    const u = state.username;
    if (!u) return null;
    const res = await SV.profile.claimUsername(u, s.user.id);
    await SV.auth.attachUsername(res.username);
    SV.analytics.track('username_claimed', { username: res.username });
    return res;
  }

  async function submit(e) {
    e.preventDefault();
    setErr({});

    setBusy(true);
    try {
      const s = isUp ? await SV.auth.signUp(form) : await SV.auth.signIn(form);
      const claimed = await claimIfNeeded(s);
      SV.analytics.track(isUp ? 'sign_up' : 'sign_in');

      // Check onboarding progression:
      let targetRoute = '/onboarding/identity';
      if (s?.user?.identity) {
        if (!s?.user?.onboarding?.surveyCompleted) {
          targetRoute = '/onboarding/survey';
        } else {
          targetRoute = resolveDashboardRoute(s.user.identity);
        }
      }

      if (claimed) {
        setDone({ ...claimed, targetRoute });
      } else {
        toast.push({
          title: isUp ? 'Account created' : 'Welcome back',
          body: isUp ? 'Please complete your setup' : s.user.name,
          tone: 'success'
        });
        onClose();
        navigate(targetRoute);
      }
    } catch (ex) {
      const code = ex.code || '';
      const msg = ex.message || '';
      const field = code.includes('name') || msg.toLowerCase().includes('name') ? 'name' :
                    code.includes('email') || msg.toLowerCase().includes('email') ? 'email' :
                    code.includes('password') || msg.toLowerCase().includes('password') ? 'password' : 'form';
      setErr({ [field]: ex.message });
    } finally { setBusy(false); }
  }

  async function claimSignedIn() {
    setBusy(true);
    try { const r = await claimIfNeeded(session); setDone(r); }
    catch (ex) { setErr({ form: ex.message }); }
    finally { setBusy(false); }
  }

  const signedInClaim = session && state.username && !done;

  return (
    <Modal open={state.open} onClose={onClose} labelledBy="auth-title">
      {done ? (
        <div className="auth-done">
          <div className="auth-seal"><Icon.seal width="26" height="26" /></div>
          <h2 id="auth-title" className="h-card" style={{ fontSize: 34 }}>It’s yours.</h2>
          <p className="muted">Your link is live. Next, let's select your identity view.</p>
          <div className="auth-url mono">{done.url}</div>
          <div style={{ display: 'grid', gap: 10, width: '100%' }}>
            <Button block onClick={() => { onClose(); navigate(done.targetRoute || '/onboarding/identity'); }}>Continue to Identity Selection</Button>
            <Button block variant="glass" icon={<Icon.copy />} onClick={async () => { await copyText('https://' + done.url); toast.push({ title: 'Link copied', body: done.url, tone: 'success' }); }}>Copy link</Button>
          </div>
        </div>
      ) : signedInClaim ? (
        <div style={{ display: 'grid', gap: 18 }}>
          <span className="eyebrow">Claim</span>
          <h2 id="auth-title" className="h-card" style={{ fontSize: 34 }}>Claim onevue.id/{state.username}</h2>
          <p className="muted">Signed in as {session.user.email}. {session.user.username ? 'This will replace onevue.id/' + session.user.username + ' as your primary link.' : ''}</p>
          {err.form && <p className="field-error" role="alert">{err.form}</p>}
          <Button block size="lg" loading={busy} onClick={claimSignedIn}>Claim it</Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <span className="eyebrow">{isUp ? 'Create account' : 'Sign in'}</span>
            <h2 id="auth-title" className="h-card" style={{ fontSize: 34 }}>
              {state.username ? <>Claim <span className="italic">onevue.id/{state.username}</span></> : isUp ? 'Claim your Onevue' : 'Welcome back'}
            </h2>
            <p className="muted" style={{ fontSize: 14.5 }}>{isUp ? 'One profile, every view. Takes about a minute.' : 'Sign in to access your identity dashboard.'}</p>
          </div>
          {isUp && <Input label="Full name" autoComplete="name" value={form.name} onChange={set('name')} error={err.name} placeholder="Amara Okafor" />}
          <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={err.email} placeholder="you@domain.com" />
          <Input label="Password" type="password" autoComplete={isUp ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} error={err.password} hint={isUp ? 'At least 8 characters.' : undefined} />

          {err.form && <p className="field-error" role="alert">{err.form}</p>}
          <Button type="submit" block size="lg" loading={busy}>{isUp ? (state.username ? 'Create account & claim' : 'Create account') : 'Sign in'}</Button>
          <p className="faint" style={{ fontSize: 13.5, textAlign: 'center' }}>
            {isUp ? 'Already have an account? ' : 'New to Onevue? '}
            <button type="button" className="link-btn" onClick={() => setState(s => ({ ...s, mode: isUp ? 'signin' : 'signup' }))}>{isUp ? 'Sign in' : 'Create one'}</button>
          </p>
        </form>
      )}
    </Modal>
  );
}



/* ---------------- URL claimer ---------------- */
function UrlClaimer({ compact, idSuffix = '' }) {
  const { openAuth } = useApp();
  const [raw, setRaw] = acUseState('');
  const [status, setStatus] = acUseState({ s: 'idle' }); // idle | checking | ok | taken | invalid
  const val = SV.profile.normalizeUsername(raw);
  const deb = useDebounced(val, 380);
  const reqId = acUseRef(0);

  acUseEffect(() => {
    if (!deb) { setStatus({ s: 'idle' }); return; }
    const fmt = SV.profile.validateUsername(deb);
    if (fmt) { setStatus({ s: 'invalid', msg: fmt }); return; }
    const id = ++reqId.current; setStatus({ s: 'checking' });
    SV.profile.checkUsername(deb).then(r => {
      if (id !== reqId.current) return;
      setStatus(r.available ? { s: 'ok' } : { s: 'taken', msg: r.reason, sug: r.suggestions });
      SV.analytics.track('username_check', { available: r.available });
    }).catch(() => id === reqId.current && setStatus({ s: 'invalid', msg: 'Couldn’t check right now. Try again.' }));
  }, [deb]);

  const typing = val !== deb;
  const st = typing && val ? 'checking' : status.s;
  const submit = (e) => {
    e.preventDefault();
    if (st === 'ok') openAuth('signup', { username: val });
    else if (!val) document.getElementById('claim-input' + idSuffix).focus();
  };
  const msg = {
    idle: 'Letters, numbers, dots and dashes.',
    checking: 'Checking availability…',
    ok: 'onevue.id/' + val + ' is available.',
    taken: status.msg,
    invalid: status.msg,
  }[st];

  return (
    <form className={'claimer' + (compact ? ' compact' : '') + ' st-' + st} onSubmit={submit}>
      <div className="claimer-box glass">
        <label htmlFor={'claim-input' + idSuffix} className="claimer-prefix">onevue.id/</label>
        <input id={'claim-input' + idSuffix} className="claimer-input" value={raw} onChange={e => setRaw(e.target.value)} placeholder="yourname"
          autoComplete="off" autoCapitalize="none" spellCheck="false" maxLength={30} aria-describedby={'claim-msg' + idSuffix} />
        <span className="claimer-state" aria-hidden="true">
          {st === 'checking' && <span className="claimer-scan" />}
          {st === 'ok' && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="claimer-ok"><Icon.check /></motion.span>}
          {(st === 'taken' || st === 'invalid') && <span className="claimer-no" />}
        </span>
        <Button type="submit" variant={st === 'ok' ? 'accent' : 'primary'} className="claimer-btn" disabled={st === 'checking' || st === 'taken' || st === 'invalid'}>
          {st === 'ok' ? 'Claim it' : 'Check'}
        </Button>
      </div>
      <div id={'claim-msg' + idSuffix} className="claimer-msg" aria-live="polite">
        <span>{msg}</span>
        {st === 'taken' && status.sug && status.sug.length > 0 && (
          <span className="claimer-sugs">Try {status.sug.map(s => <button type="button" key={s} className="chip" onClick={() => setRaw(s)}>{s}</button>)}</span>
        )}
      </div>
    </form>
  );
}

/* ---------------- Navbar ---------------- */
const NAV_LINKS = [
  { id: 'how', label: 'How it works' },
  { id: 'views', label: 'Views' },
  { id: 'themes', label: 'Themes' },
  { id: 'verified', label: 'Verified' },
  { id: 'pricing', label: 'Pricing' },
];

function Brand() {
  return (
    <ReactRouterDOM.Link to="/" className="brand" aria-label="Onevue home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <span className="brand-mark" aria-hidden="true"><span /></span>
      <span className="brand-word serif">Onevue</span>
    </ReactRouterDOM.Link>
  );
}

function Navbar() {
  const { openAuth } = useApp();
  const session = useSession();
  const toast = useToast();
  const navigate = ReactRouterDOM.useNavigate();
  const loc = ReactRouterDOM.useLocation();
  const [scrolled, setScrolled] = acUseState(false);
  const [menu, setMenu] = acUseState(false);
  const [active, setActive] = acUseState('');
  acUseEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on);
  }, []);
  acUseEffect(() => {
    if (loc.pathname !== '/') return;
    const els = NAV_LINKS.map(l => document.getElementById(l.id)).filter(Boolean);
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    els.forEach(el => io.observe(el)); return () => io.disconnect();
  }, [loc.pathname]);

  const targetDashboard = session ? resolveDashboardRoute(session.user?.identity) : '/dashboard';
  const isDashboard = loc.pathname.startsWith('/app') || loc.pathname === '/dashboard';

  const go = (id) => {
    setMenu(false);
    if (loc.pathname !== '/') { navigate('/'); setTimeout(() => scrollToId(id), 120); }
    else scrollToId(id);
  };
  const primaryCta = () => {
    setMenu(false);
    if (session) navigate(targetDashboard);
    else openAuth('signup');
  };
  const signOut = async () => {
    await SV.auth.signOut();
    setMenu(false);
    toast.push({ title: 'Signed out' });
    if (isDashboard) navigate('/');
  };

  // On Student Dashboard, the dedicated StudentTopbar provides hybrid dashboard navigation
  if (loc.pathname.startsWith('/app/student')) {
    return null;
  }

  return (
    <>
      <header className={'nav' + (scrolled ? ' is-scrolled' : '')}>
        <div className="nav-inner glass">
          <Brand />
          {!session ? (
            <nav className="nav-links" aria-label="Primary">
              {NAV_LINKS.map(l => <button key={l.id} className={'nav-link' + (active === l.id ? ' is-on' : '')} onClick={() => go(l.id)}>{l.label}</button>)}
            </nav>
          ) : (
            <nav className="nav-links" aria-label="Primary">
              {isDashboard && <span className="nav-link is-on" style={{ cursor: 'default' }}>Dashboard</span>}
            </nav>
          )}
          <div className="nav-right">
            <ThemePill />
            {session ? (
              <>
                {!isDashboard && <Button size="sm" className="hide-sm" variant="glass" onClick={() => navigate(targetDashboard)}>Dashboard</Button>}
                <Button size="sm" variant="glass" className="danger hide-sm" onClick={signOut}>Sign out</Button>
                <button className="nav-user" onClick={() => navigate(targetDashboard)} aria-label="Dashboard"><Avatar initials={session.user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()} size={34} /></button>
              </>
            ) : (
              <>
                <button className="nav-link hide-sm" onClick={() => openAuth('signin')}>Sign in</button>
                <Button size="sm" onClick={primaryCta}>Claim your Onevue</Button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

Object.assign(window, { AppProvider, useApp, UrlClaimer, Navbar, Brand, NAV_LINKS, IDENTITY_OPTIONS, DASHBOARD_ROUTES, resolveDashboardRoute });
