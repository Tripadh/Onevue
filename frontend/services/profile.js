/* profile service — usernames, profile records, profile types. */
(function () {
  const { db, http, latency, uid, isLive, ServiceError } = window.OV.core;

  const PROFILE_TYPES = [
    { id: 'student', name: 'Student', line: 'Grades, projects and activities, shaped for admissions and first jobs.', sections: ['Education', 'Projects', 'Activities', 'Verified transcripts'], glyph: 'I' },
    { id: 'professional', name: 'Professional', line: 'A career record that proves itself, with employment checked at the source.', sections: ['Experience', 'Skills', 'Verified employers', 'References'], glyph: 'II' },
    { id: 'freelancer', name: 'Freelancer', line: 'Services, rates and case studies that clients can book from a single link.', sections: ['Services', 'Case studies', 'Rates', 'Client reviews'], glyph: 'III' },
    { id: 'creator', name: 'Creator', line: 'Your work, audience and partnerships, presented like a media kit.', sections: ['Featured work', 'Audience', 'Partnerships', 'Press'], glyph: 'IV' },
    { id: 'business', name: 'Business', line: 'A company identity with verified registration, team and offerings.', sections: ['Company', 'Team', 'Offerings', 'Registration'], glyph: 'V' },
  ];

  /** @param {string} raw */
  function normalizeUsername(raw) { return String(raw || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30); }

  /** Validates format, returns error message or null. */
  function validateUsername(u) {
    if (!u) return 'Type a username to check it.';
    if (u.length < 3) return 'At least 3 characters.';
    if (!/^[a-z0-9]/.test(u)) return 'Start with a letter or number.';
    if (/[._-]$/.test(u)) return 'Can’t end with a symbol.';
    if (/[._-]{2,}/.test(u)) return 'No repeated symbols.';
    return null;
  }

  function suggestions(u) {
    const base = u.replace(/[._-]/g, '').slice(0, 20) || 'you';
    const opts = [base + '.studio', base + '.id', 'hey' + base, base + new Date().getFullYear() % 100, 'the' + base];
    return opts.filter(o => !isTakenSync(o)).slice(0, 3);
  }

  function isTakenSync(u) {
    return db.list('c:reserved_usernames').includes(u) || !!db.find('c:claims', c => c.username === u) || !!db.find('c:profiles', p => p.username === u);
  }

  /** @returns {Promise<{username:string, available:boolean, reason?:string, suggestions:string[]}>} */
  async function checkUsername(raw) {
    const username = normalizeUsername(raw);
    const err = validateUsername(username);
    if (err) return { username, available: false, reason: err, suggestions: [] };
    if (isLive()) return http('GET', '/usernames/' + encodeURIComponent(username));
    await latency(500, 900);
    const taken = isTakenSync(username);
    return { username, available: !taken, reason: taken ? 'Already claimed.' : undefined, suggestions: taken ? suggestions(username) : [] };
  }

  /** Reserves a username for the signed-in user (or a guest hold that becomes theirs on sign-up). */
  async function claimUsername(raw, userId) {
    const username = normalizeUsername(raw);
    if (isLive()) return http('POST', '/usernames', { username });
    await latency(300, 500);
    const existing = db.find('c:claims', c => c.username === username);
    if (existing && existing.userId !== userId) throw new ServiceError('taken', 'Someone just claimed that one.');
    if (db.list('c:reserved_usernames').includes(username)) throw new ServiceError('taken', 'That username is reserved.');
    if (!existing) db.insert('c:claims', { id: uid('clm'), username, userId, createdAt: new Date().toISOString() });
    // starter profile
    if (userId && !db.find('c:profiles', p => p.userId === userId)) {
      const sessionUser = db.get('session', null)?.user;
      const initialType = (u && u.identity) || (sessionUser && sessionUser.identity) || 'professional';
      db.insert('c:profiles', { id: uid('pf'), userId, username, name: u ? u.name : username, headline: '', type: initialType, summary: '', experience: [], education: [], skills: [], portfolio: [], services: [], testimonials: [], activities: [], links: {}, avatarInitials: (u ? u.name : username).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() });

    }
    return { username, url: window.OV.core.env.PUBLIC_BASE + '/' + username };
  }

  async function getProfileByUsername(username) {
    if (isLive()) return http('GET', '/profiles/' + encodeURIComponent(username));
    await latency(120, 260);
    return db.find('c:profiles', p => p.username === normalizeUsername(username));
  }

  async function getMyProfile(userId) {
    if (isLive()) return http('GET', '/me/profile');
    await latency(80, 160);
    return db.find('c:profiles', p => p.userId === userId);
  }

  async function updateMyProfile(userId, patch) {
    if (isLive()) return http('PATCH', '/me/profile', patch);
    await latency(200, 400);
    const p = db.find('c:profiles', x => x.userId === userId);
    if (!p) throw new ServiceError('no_profile', 'Claim a username first.');
    return db.update('c:profiles', p.id, patch);
  }

  /** The showcase profile used by the landing page demo. */
  async function getDemoProfile() { return getProfileByUsername('amara'); }

  async function listProfileTypes() { return PROFILE_TYPES; }

  window.OV.services.profile = { normalizeUsername, validateUsername, checkUsername, claimUsername, getProfileByUsername, getMyProfile, updateMyProfile, getDemoProfile, listProfileTypes };
})();
