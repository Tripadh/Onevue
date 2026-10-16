/* auth service — sign up / sign in / session. Swap internals for live API only. */
(function () {
  const { db, http, latency, uid, isLive, ServiceError } = window.OV.core;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(getSessionSync()));
  function getSessionSync() { return db.get('session', null); }
  const clean = u => u && ({ id: u.id, name: u.name, email: u.email, username: u.username, identity: u.identity, onboarding: u.onboarding, createdAt: u.createdAt });
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); };

  /** @returns {Promise<Session|null>} */
  async function getSession() {
    if (isLive()) { try { return await http('GET', '/auth/session'); } catch (e) { return null; } }
    return getSessionSync();
  }

  const API_BASE = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';

  /** @param {{name:string,email:string,password:string,identity:string,username?:string}} input */
  async function signUp(input) {
    if (isLive()) { const s = await http('POST', '/auth/signup', input); db.set('session', s); emit(); return s; }
    
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: input.name, 
          email: input.email, 
          password: input.password,
          identity: input.identity 
        })
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('signup_failed', data.message || 'Registration failed');
      
      const session = { token: data.token, user: clean(data.user) };
      db.set('session', session); emit();
      return session;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to the server.');
    }
  }

  /** @param {{email:string,password:string}} input */
  async function signIn(input) {
    if (isLive()) { const s = await http('POST', '/auth/signin', input); db.set('session', s); emit(); return s; }
    
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password })
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('login_failed', data.message || 'Login failed');
      
      const session = { token: data.token, user: clean(data.user) };
      db.set('session', session); emit();
      return session;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to the server.');
    }
  }

  /** Calls protected dashboard API to verify backend authorization */
  async function getDashboardData(role) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');
    try {
      const res = await fetch(`${API_BASE}/dashboard/${encodeURIComponent(role)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new ServiceError(res.status === 403 ? 'forbidden' : 'fetch_error', data.message || 'Failed to load dashboard');
      }
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to dashboard service.');
    }
  }

  /** Saves user's selected identity on the onboarding page */
  async function setIdentity(identity) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');
    try {
      const res = await fetch(`${API_BASE}/auth/set-identity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
        body: JSON.stringify({ identity }),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('set_identity_failed', data.message || 'Failed to update identity');
      
      const session = { token: data.token, user: clean(data.user) };
      db.set('session', session); emit();
      return session;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not save identity to server.');
    }
  }

  /** Submits survey response to MongoDB */
  async function submitSurvey(surveyData) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');
    try {
      const res = await fetch(`${API_BASE}/auth/submit-survey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
        body: JSON.stringify(surveyData),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('survey_failed', data.message || 'Failed to submit survey');

      const session = { token: data.token, user: clean(data.user) };
      db.set('session', session); emit();
      return session;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not save survey response to server.');
    }
  }

  async function signOut() {
    if (isLive()) { try { await http('POST', '/auth/signout'); } catch (e) {} }
    db.remove('session'); emit();
  }

  /** Internal helper for other services to attach a username to the user. */
  async function attachUsername(username) {
    const s = getSessionSync(); if (!s) return null;
    if (!isLive()) db.update('c:users', s.user.id, { username });
    const next = { ...s, user: { ...s.user, username } };
    db.set('session', next); emit(); return next;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.OV.services.auth = { getSession, getSessionSync, signUp, signIn, signOut, attachUsername, onChange, getDashboardData, setIdentity, submitSurvey };

})();

