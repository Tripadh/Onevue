const { useState: authPageUseState } = React;
const AUTH_SERVICES = window.OV.services;

function AuthBrand() {
  return (
    <ReactRouterDOM.Link to="/" className="auth-brand" aria-label="Onevue home">
      <span className="brand-mark" aria-hidden="true"><span /></span>
      <span>onevue</span>
    </ReactRouterDOM.Link>
  );
}

function AuthShell({ children, eyebrow, title, description }) {
  return (
    <main className="auth-page" id="main">
      <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
      <div className="auth-orbit auth-orbit-two" aria-hidden="true" />
      <div className="auth-orbit auth-orbit-three" aria-hidden="true" />
      <header className="auth-nav">
        <AuthBrand />
        <ReactRouterDOM.Link to="/" className="auth-home-link">Back to home <span aria-hidden="true">↗</span></ReactRouterDOM.Link>
      </header>
      <section className="auth-layout" aria-labelledby="auth-title">
        <div className="auth-intro">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        <div className="auth-panel">{children}</div>
      </section>
      <p className="auth-footer">© {new Date().getFullYear()} Onevue <span aria-hidden="true">·</span> One identity. Every view.</p>
    </main>
  );
}

function AuthField({ label, type = 'text', value, onChange, error, autoComplete, placeholder, action, endAction }) {
  const id = 'auth-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className="auth-input-wrap">
        <input id={id} type={type} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} />
        {endAction}
        {error && <span className="auth-field-error" id={`${id}-error`} role="alert">{error}</span>}
      </div>
    </div>
  );
}

function GoogleButton({ onError }) {
  return (
    <button type="button" className="auth-social" onClick={() => {
      try { AUTH_SERVICES.auth.signInWithGoogle(); }
      catch (error) { onError(error.message || 'Google sign-in is unavailable.'); }
    }}>
      <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.35 12.22c0-.7-.06-1.37-.18-2.02H12v3.83h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.2Z" />
        <path fill="#34A853" d="M12 21.75c2.63 0 4.84-.87 6.46-2.33l-3.14-2.45c-.87.58-1.98.92-3.32.92-2.55 0-4.71-1.72-5.49-4.04H3.27v2.53A9.75 9.75 0 0 0 12 21.75Z" />
        <path fill="#FBBC05" d="M6.51 13.85a5.86 5.86 0 0 1 0-3.7V7.62H3.27a9.75 9.75 0 0 0 0 8.76l3.24-2.53Z" />
        <path fill="#EA4335" d="M12 6.11c1.43 0 2.71.49 3.73 1.46l2.8-2.8C16.84 3.2 14.63 2.25 12 2.25a9.75 9.75 0 0 0-8.73 5.37l3.24 2.53C7.29 7.83 9.45 6.11 12 6.11Z" />
      </svg>
      Continue with Google
    </button>
  );
}

function AuthDivider() {
  return <div className="auth-divider"><span>OR</span></div>;
}

function authTarget(session) {
  if (!session?.user?.identity) return '/onboarding/identity';
  if (!session.user.onboarding?.surveyCompleted) return '/onboarding/survey';
  return window.resolveDashboardRoute(session.user.identity);
}

function AuthLoginPage() {
  const navigate = ReactRouterDOM.useNavigate();
  const username = new URLSearchParams(window.location.hash.split('?')[1] || '').get('username') || '';
  const [email, setEmail] = authPageUseState('');
  const [password, setPassword] = authPageUseState('');
  const [showPassword, setShowPassword] = authPageUseState(false);
  const [error, setError] = authPageUseState('');
  const [busy, setBusy] = authPageUseState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim() || !password) { setError('Enter your email and password to continue.'); return; }
    setBusy(true);
    try {
      const session = await AUTH_SERVICES.auth.signIn({ email: email.trim(), password });
      if (username) {
        const claimed = await AUTH_SERVICES.profile.claimUsername(username, session.user.id);
        await AUTH_SERVICES.auth.attachUsername(claimed.username);
      }
      navigate(authTarget(session), { replace: true });
    }
    catch (ex) { setError(ex.message || 'We could not sign you in. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <AuthShell eyebrow="Welcome back" title={<>Your identity, <em>your way.</em></>} description="Showcase who you are. Share what you do. Make connections that matter.">
      <GoogleButton onError={setError} />
      <AuthDivider />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@domain.com" error={error && !password ? error : ''} />
        <AuthField label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="Enter your password" action={<ReactRouterDOM.Link to="/forgot-password" className="auth-inline-link">Forgot password?</ReactRouterDOM.Link>} endAction={<button type="button" className="auth-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>} />
        {error && password && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span></button>
      </form>
      <p className="auth-switch">New to Onevue? <ReactRouterDOM.Link to="/signup">Create an account</ReactRouterDOM.Link></p>
      <p className="auth-legal">By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </AuthShell>
  );
}

function AuthSignupPage() {
  const navigate = ReactRouterDOM.useNavigate();
  const username = new URLSearchParams(window.location.hash.split('?')[1] || '').get('username') || '';
  const [form, setForm] = authPageUseState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = authPageUseState('');
  const [busy, setBusy] = authPageUseState(false);
  const [terms, setTerms] = authPageUseState(false);
  const update = key => event => setForm(current => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!form.name.trim() || !form.email.trim() || !form.password) { setError('Complete all required fields.'); return; }
    if (form.password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (!terms) { setError('Please accept the Terms and Privacy Policy to continue.'); return; }
    setBusy(true);
    try {
      const session = await AUTH_SERVICES.auth.signUp({ name: form.name.trim(), email: form.email.trim(), password: form.password, identity: '' });
      if (username) {
        const claimed = await AUTH_SERVICES.profile.claimUsername(username, session.user.id);
        await AUTH_SERVICES.auth.attachUsername(claimed.username);
      }
      navigate(authTarget(session), { replace: true });
    } catch (ex) { setError(ex.message || 'We could not create your account. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <AuthShell eyebrow="Create your account" title={<>Make your mark, <em>your way.</em></>} description="One profile, every view. Start with the essentials and shape the rest as you go.">
      <GoogleButton onError={setError} />
      <AuthDivider />
      <form className="auth-form" onSubmit={submit} noValidate>
        <AuthField label="Full name" value={form.name} onChange={update('name')} autoComplete="name" placeholder="Amara Okafor" />
        <AuthField label="Email address" type="email" value={form.email} onChange={update('email')} autoComplete="email" placeholder="you@domain.com" />
        <AuthField label="Password" type="password" value={form.password} onChange={update('password')} autoComplete="new-password" placeholder="At least 8 characters" />
        <AuthField label="Confirm password" type="password" value={form.confirm} onChange={update('confirm')} autoComplete="new-password" placeholder="Repeat your password" />
        <label className="auth-check"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /> <span>I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</span></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'} <span aria-hidden="true">→</span></button>
      </form>
      <p className="auth-switch">Already have an account? <ReactRouterDOM.Link to="/login">Sign in</ReactRouterDOM.Link></p>
    </AuthShell>
  );
}

function AuthForgotPasswordPage() {
  const [email, setEmail] = authPageUseState('');
  const [error, setError] = authPageUseState('');
  return (
    <AuthShell eyebrow="Password recovery" title={<>A fresh start is <em>close.</em></>} description="Enter the email connected to your Onevue account and we’ll help you get back in.">
      <form className="auth-form" onSubmit={event => { event.preventDefault(); if (!email.trim()) { setError('Enter the email connected to your account.'); return; } setError('Password recovery is not configured on this workspace yet. Please contact your administrator.'); }} noValidate>
        <AuthField label="Email address" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} autoComplete="email" placeholder="you@domain.com" />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit">Send recovery link <span aria-hidden="true">→</span></button>
      </form>
      <p className="auth-switch"><ReactRouterDOM.Link to="/login">← Back to sign in</ReactRouterDOM.Link></p>
    </AuthShell>
  );
}

Object.assign(window, { AuthLoginPage, AuthSignupPage, AuthForgotPasswordPage });
