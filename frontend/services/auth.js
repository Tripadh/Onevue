/* auth service — sign up / sign in / session. Swap internals for live API only. */
(function () {
  const { db, http, latency, uid, isLive, ServiceError } = window.OV.core;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(getSessionSync()));
  function getSessionSync() { return db.get('session', null); }
  const clean = u => {
    if (!u) return null;
    let photoUrl = u.profilePhotoUrl || null;
    if (photoUrl && !photoUrl.startsWith('http')) {
      const origin = API_BASE.replace(/\/api\/?$/, '');
      photoUrl = `${origin}${photoUrl.startsWith('/') ? '' : '/'}${photoUrl}`;
    }
    return {
      id: u.id || u._id,
      name: u.name,
      email: u.email,
      username: u.username || null,
      identity: u.identity,
      bio: u.bio || '',
      location: u.location || '',
      profilePhotoKey: u.profilePhotoKey || null,
      profilePhotoUrl: photoUrl,
      profilePhotoUpdatedAt: u.profilePhotoUpdatedAt || null,
      onboarding: u.onboarding,
      createdAt: u.createdAt,
    };
  };
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

  /** Fetch authenticated user profile from backend */
  async function getProfile() {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('fetch_error', data.message || 'Failed to load profile');

      const updatedUser = clean(data.user);
      const nextSession = { ...s, user: updatedUser };
      db.set('session', nextSession);
      emit();
      return updatedUser;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to profile service.');
    }
  }

  /** Update editable account profile fields (name, username, bio, location) */
  async function updateProfile(patch) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('update_error', data.message || 'Failed to update profile');

      const updatedUser = clean(data.user);
      const nextSession = { ...s, user: updatedUser };
      db.set('session', nextSession);
      emit();
      return updatedUser;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not save profile changes.');
    }
  }

  /** Upload a new profile photo (validates image type and size) */
  async function uploadProfilePhoto(file) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/profile/photo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${s.token}`,
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('upload_error', data.message || 'Failed to upload photo');

      let resolvedUrl = data.profilePhotoUrl;
      if (resolvedUrl && !resolvedUrl.startsWith('http')) {
        const origin = API_BASE.replace(/\/api\/?$/, '');
        resolvedUrl = `${origin}${resolvedUrl.startsWith('/') ? '' : '/'}${resolvedUrl}`;
      }
      // Add version cache-buster query parameter to force instantaneous reload
      if (resolvedUrl) {
        resolvedUrl += `${resolvedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
      }

      const nextUser = {
        ...s.user,
        profilePhotoKey: data.profilePhotoKey,
        profilePhotoUrl: resolvedUrl,
        profilePhotoUpdatedAt: data.profilePhotoUpdatedAt,
      };
      const nextSession = { ...s, user: nextUser };
      db.set('session', nextSession);
      emit();
      return { ...data, profilePhotoUrl: resolvedUrl };
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not upload profile photo.');
    }
  }

  /** Remove current profile photo */
  async function removeProfilePhoto() {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/profile/photo`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${s.token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('delete_error', data.message || 'Failed to remove photo');

      const nextUser = {
        ...s.user,
        profilePhotoKey: null,
        profilePhotoUrl: null,
        profilePhotoUpdatedAt: null,
      };
      const nextSession = { ...s, user: nextUser };
      db.set('session', nextSession);
      emit();
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not remove profile photo.');
    }
  }

  /** Change user account password */
  async function changePassword({ currentPassword, newPassword, confirmPassword }) {
    const s = getSessionSync();
    if (!s || !s.token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/profile/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('password_error', data.message || 'Failed to update password');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to password service.');
    }
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  window.OV.services.auth = {
    getSession,
    getSessionSync,
    signUp,
    signIn,
    signOut,
    attachUsername,
    onChange,
    getDashboardData,
    setIdentity,
    submitSurvey,
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto,
    changePassword,
  };

})();

