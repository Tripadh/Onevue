/* OneVue's shared identity workspace.
 * The shell is shared; the editorial content, work shelves, and labels are
 * composed from the authenticated identity's existing profile document.
 */
const { useState: idState, useEffect: idEffect, useMemo: idMemo, useCallback: idCallback } = React;
const { useLocation: idLocation, useNavigate: idNavigate } = ReactRouterDOM;

const IDENTITY_DASHBOARD_CONFIG = {
  student: {
    label: 'Student',
    basePath: '/app/student',
    profileEndpoint: 'student/profile',
    overview: 'Academic overview',
    statement: 'A verified academic identity for the next opportunity.',
    focus: 'Academic signal',
    primary: (p) => primaryEducation(p)?.institution,
    secondary: (p) => primaryEducation(p)?.degree,
    metrics: [
      ['Graduation year', (p) => primaryEducation(p)?.gradYear || primaryEducation(p)?.expectedGradDate],
      ['GPA', (p) => primaryEducation(p)?.gpa],
      ['Projects', (p) => count(p?.projects, 'project')],
      ['Skills', (p) => count(p?.skills, 'skill')],
    ],
    workTitle: 'Projects & coursework',
    work: (p) => p?.projects || [],
    workName: (item) => item?.title,
    workDetail: (item) => item?.shortDescription || item?.summary || item?.projectType,
    action: 'Complete academic identity',
  },
  freelancer: {
    label: 'Freelancer',
    basePath: '/app/freelancer',
    profileEndpoint: 'freelancer',
    overview: 'Independent practice',
    statement: 'A client-facing practice with a point of view, not just a list of services.',
    focus: 'Client signal',
    primary: (p) => p?.specialization,
    secondary: (p) => p?.availability,
    metrics: [
      ['Services', (p) => count(p?.services, 'service')],
      ['Packages', (p) => count((p?.services || []).flatMap((s) => s?.packages || []), 'package')],
      ['Work experience', (p) => count(p?.workExperience, 'role')],
      ['Engagements', (p) => list(p?.engagementTypes)],
    ],
    workTitle: 'Selected work',
    work: (p) => p?.portfolio || p?.services || [],
    workName: (item) => item?.title || item?.name,
    workDetail: (item) => item?.summary || item?.description || item?.outcome,
    action: 'Shape client presence',
  },
  business: {
    label: 'Business',
    basePath: '/app/business',
    profileEndpoint: 'business',
    overview: 'Company presence',
    statement: 'A considered company presence for partners, customers, and the people you want to reach.',
    focus: 'Business signal',
    primary: (p) => p?.businessName,
    secondary: (p) => p?.industry,
    metrics: [
      ['Offerings', (p) => count([...(p?.products || []), ...(p?.services || [])], 'offering')],
      ['Team', (p) => count(p?.team, 'member')],
      ['Case studies', (p) => count(p?.caseStudies, 'case study')],
      ['Business presence analytics', (p) => p?.analytics ? 'Available' : 'Not added'],
      ['Website', (p) => p?.website ? 'Configured' : 'Not added'],
    ],
    workTitle: 'Offerings & proof',
    work: (p) => [...(p?.products || []), ...(p?.services || []), ...(p?.caseStudies || [])],
    workName: (item) => item?.name || item?.title,
    workDetail: (item) => item?.description || item?.summary,
    action: 'Clarify company presence',
  },
  professional: {
    label: 'Professional',
    basePath: '/app/professional',
    profileEndpoint: 'professional',
    overview: 'Career identity',
    statement: 'A concise, evidence-led view of the work you are ready to do next.',
    focus: 'Career signal',
    primary: (p) => p?.currentEmployment?.jobTitle,
    secondary: (p) => p?.currentEmployment?.company,
    metrics: [
      ['Experience', (p) => experience(p)],
      ['Skills', (p) => count(p?.skills, 'skill')],
      ['Credentials', (p) => count([...(p?.certifications || []), ...(p?.achievements || [])], 'record')],
      ['Portfolio', (p) => count(p?.portfolio, 'item')],
    ],
    workTitle: 'Work with context',
    work: (p) => p?.portfolio || p?.achievements || [],
    workName: (item) => item?.title,
    workDetail: (item) => item?.summary || item?.description || item?.outcome,
    action: 'Strengthen career signal',
  },
  creator: {
    label: 'Content Creator',
    basePath: '/app/creator',
    profileEndpoint: 'creator',
    overview: 'Creator presence',
    statement: 'A living media kit for the work, communities, and collaborations that define your niche.',
    focus: 'Audience signal',
    primary: (p) => p?.displayName || p?.niche,
    secondary: (p) => p?.niche,
    metrics: [
      ['Platforms', (p) => count(p?.channels, 'platform')],
      ['Featured content', (p) => count(p?.featuredContent, 'piece')],
      ['Audience metrics', (p) => count(p?.audienceStats, 'metric')],
      ['Collaborations', (p) => count(p?.pastCollaborations, 'collaboration')],
    ],
    workTitle: 'Featured content',
    work: (p) => p?.featuredContent || [],
    workName: (item) => item?.title,
    workDetail: (item) => item?.summary || item?.format || item?.category,
    action: 'Shape creator presence',
  },
};

function primaryEducation(profile) {
  return Array.isArray(profile?.education) ? profile.education[0] : null;
}

function count(value, singular) {
  const total = Array.isArray(value) ? value.length : 0;
  return total ? `${total} ${singular}${total === 1 ? '' : 's'}` : '';
}

function list(value) {
  return Array.isArray(value) && value.length ? value.join(' · ') : '';
}

function experience(profile) {
  const roles = [profile?.currentEmployment, ...(profile?.employmentHistory || [])].filter((role) => role?.startDate);
  if (!roles.length) return '';
  const years = roles.reduce((total, role) => {
    const start = new Date(role.startDate);
    const end = role.isCurrent ? new Date() : new Date(role.endDate || role.startDate);
    return total + Math.max(0, (end - start) / (365.25 * 24 * 60 * 60 * 1000));
  }, 0);
  return `${Math.round(years * 10) / 10} years`;
}

function valueOrEmpty(value) {
  return value === undefined || value === null || value === '' ? '' : String(value);
}

function tokenIsExpired(token) {
  if (!token || typeof token !== 'string') return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000;
  } catch (error) {
    return true;
  }
}

function studentWorkspace(profile) {
  return profile;
}

function mappedWorkspace(identity, profile, user) {
  if (identity === 'student') return studentWorkspace(profile);
  return window.OV.identityWorkspace.toWorkspaceProfile(identity, profile, user);
}

function identityResource(profile, identity) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  return config.work(profile);
}

function initials(name) {
  return String(name || 'OneVue').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function SharedFloatingNavigation({ identity, session, activeNav, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const [accountOpen, setAccountOpen] = idState(false);
  const [searchOpen, setSearchOpen] = idState(false);
  const toast = useToast();
  const navItems = [
    ['overview', 'Overview', config.basePath],
    ['identity', 'Identity', `${config.basePath}/identity`],
    ['visiting-card', 'Visiting Card', `${config.basePath}/visiting-card/overview`],
    ['analytics', 'Analytics', `${config.basePath}/analytics`],
    ['website', 'My Website', `${config.basePath}/website`],
  ];

  const signOut = async () => {
    try {
      await window.OV.services.auth.signOut();
      onNavigate('/');
    } catch (error) {
      toast.push({ title: 'Could not sign out', body: 'Please try again.', tone: 'error' });
    }
  };

  return (
    <header className="identity-floating-nav glass" aria-label="Dashboard navigation">
      <button className="identity-brand" onClick={() => onNavigate(config.basePath)} aria-label="OneVue overview">
        <span className="brand-mark"><span /></span>
        <span className="brand-word serif">OneVue</span>
      </button>
      <nav className="identity-nav-links" aria-label={`${config.label} workspace`}>
        {navItems.map(([id, label, path]) => (
          <button key={id} className={activeNav === id ? 'is-active' : ''} onClick={() => onNavigate(path)}>{label}</button>
        ))}
      </nav>
      <div className="identity-nav-actions">
        <button className="identity-nav-icon" onClick={() => setSearchOpen(!searchOpen)} aria-label="Search" title="Search"><StudentIcon name="search" /></button>
        <button className="identity-nav-icon" onClick={() => toast.push({ title: 'Notifications', body: 'No pending alerts.', tone: 'info' })} aria-label="Notifications" title="Notifications"><StudentIcon name="bell" /></button>
        <ThemePill />
        <div className="identity-account-wrap">
          <button className="identity-account" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen}>
            <Avatar initials={initials(session?.user?.name)} src={session?.user?.profilePhotoUrl} size={32} ring />
            <span>{session?.user?.name || config.label}</span>
          </button>
          {accountOpen && (
            <div className="identity-account-menu glass">
              <button onClick={() => { setAccountOpen(false); onNavigate(`${config.basePath}/profile`); }}>Profile settings</button>
              <button onClick={() => { setAccountOpen(false); onNavigate(`${config.basePath}/identity`); }}>Edit identity</button>
              <button onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>
      {searchOpen && (
        <div className="identity-search-pop glass">
          <StudentIcon name="search" />
          <input autoFocus className="input" placeholder={`Search your ${config.label.toLowerCase()} profile`} aria-label="Search dashboard" />
          <button onClick={() => setSearchOpen(false)} aria-label="Close search">×</button>
        </div>
      )}
    </header>
  );
}

function StudentIcon({ name }) {
  const icons = window.StudentIcons || {};
  const IconComponent = icons[name] || icons.overview;
  return IconComponent ? <IconComponent /> : null;
}

function QRPreview({ url }) {
  const [matrix, setMatrix] = idState(null);
  idEffect(() => {
    let active = true;
    if (!url || !window.OV?.services?.shares?.qrMatrix) return undefined;
    window.OV.services.shares.qrMatrix(url, 21).then((result) => { if (active) setMatrix(result); }).catch(() => {});
    return () => { active = false; };
  }, [url]);

  if (!url || !matrix) return <div className="identity-qr-empty" aria-label="QR code unavailable">QR</div>;
  return (
    <svg className="identity-qr" viewBox="-1 -1 23 23" role="img" aria-label={`QR code for ${url}`}>
      <rect x="-1" y="-1" width="23" height="23" rx="1" className="identity-qr-bg" />
      {matrix.map((row, r) => row.map((on, c) => on ? <rect key={`${r}-${c}`} x={c} y={r} width=".9" height=".9" className="identity-qr-module" /> : null))}
    </svg>
  );
}

function IdentityHero({ identity, profile, session, websiteConfig, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const name = identity === 'business' ? config.primary(profile) : session?.user?.name;
  const identityLine = [config.primary(profile), config.secondary(profile)].filter(Boolean).join(' · ');
  const username = session?.user?.username;
  const publicUrl = username ? `onevue.id/${username}` : '';
  const status = websiteConfig?.status === 'published' ? 'Published presence' : websiteConfig ? 'Draft presence' : 'Presence not published';
  return (
    <section className={`identity-hero identity-hero-${identity}`}>
      <div className="identity-hero-copy">
        <span className="eyebrow">{config.overview}</span>
        <h1>{valueOrEmpty(name) || `Your ${config.label.toLowerCase()} identity`}</h1>
        <p className="identity-hero-statement">{config.statement}</p>
        <div className="identity-hero-meta">
          <span className="badge badge-verified badge-dot">{status}</span>
          {identityLine && <span className="identity-hero-line">{identityLine}</span>}
        </div>
        <div className="identity-hero-actions">
          <Button size="sm" variant="primary" onClick={() => onNavigate(`${config.basePath}/identity`)}>Edit identity</Button>
          <Button size="sm" variant="glass" onClick={() => onNavigate(`${config.basePath}/website/preview`)}>Preview presence</Button>
        </div>
      </div>
      <div className="identity-hero-art" aria-label={`${config.label} identity preview`}>
        <div className="identity-hero-orbit identity-orbit-one" />
        <div className="identity-hero-orbit identity-orbit-two" />
        <div className="identity-hero-monogram">{initials(name || config.label)}</div>
        <div className="identity-hero-caption"><span>{config.focus}</span><strong>{username ? `/${username}` : 'Claim your public link'}</strong></div>
      </div>
    </section>
  );
}

function CompletionPanel({ identity, profile, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const fields = config.metrics.map(([, read]) => read(profile)).filter(Boolean).length;
  const completion = Math.round((fields / config.metrics.length) * 100);
  return (
    <section className="identity-completion">
      <div className="identity-section-label"><span>01</span><h2>Profile completion</h2><strong>{completion}%</strong></div>
      <div className="identity-completion-line"><span style={{ width: `${completion}%` }} /></div>
      <p>{completion === 100 ? 'Your identity has a complete first impression.' : `${config.action}. Add the missing signals before you publish.`}</p>
      <button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/identity`)}>Continue shaping →</button>
    </section>
  );
}

function MetricRail({ identity, profile }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  return (
    <section className="identity-metric-rail">
      {config.metrics.map(([label, read], index) => (
        <div className={`identity-metric identity-metric-${index}`} key={label}>
          <span>{label}</span>
          <strong>{valueOrEmpty(read(profile)) || '—'}</strong>
        </div>
      ))}
    </section>
  );
}

function WorkShelf({ identity, profile, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const items = identityResource(profile, identity).slice(0, 4);
  return (
    <section className="identity-work-shelf">
      <div className="identity-section-heading"><div><span className="eyebrow">02 / Evidence</span><h2>{config.workTitle}</h2></div><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/identity`)}>Manage work →</button></div>
      {items.length ? (
        <div className="identity-work-grid">
          {items.map((item, index) => (
            <article className={`identity-work-item identity-work-item-${index}`} key={item?._id || item?.id || `${config.label}-${index}`}>
              <span className="identity-work-index">0{index + 1}</span>
              <h3>{valueOrEmpty(config.workName(item)) || 'Untitled work'}</h3>
              <p>{valueOrEmpty(config.workDetail(item)) || 'Add context so people understand the value of this work.'}</p>
              <span className="identity-work-arrow">↗</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="identity-empty-state"><span className="identity-empty-mark">+</span><div><h3>Give your work a place to land</h3><p>Published work, services, and proof will become the visual centre of this dashboard.</p></div><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/identity`)}>Add first item →</button></div>
      )}
    </section>
  );
}

function PresencePanel({ identity, profile, session, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const workspace = mappedWorkspace(identity, profile, session?.user) || {};
  const url = session?.user?.username ? `https://onevue.id/${session.user.username}` : '';
  return (
    <section className="identity-presence">
      <div className="identity-section-heading"><div><span className="eyebrow">03 / Distribution</span><h2>Digital presence</h2></div><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/website`)}>Open website →</button></div>
      <div className="identity-presence-grid">
        <div className="identity-card-preview">
          <div className="identity-card-top"><span className="brand-word serif">OneVue</span><span className="badge badge-verified">Live card</span></div>
          <div className="identity-card-person"><span className="avatar" style={{ '--s': '52px' }}>{initials(workspace.name || session?.user?.name)}</span><div><strong>{workspace.name || session?.user?.name || config.label}</strong><span>{workspace.role || config.secondary(profile) || 'Add a headline'}</span></div></div>
          <div className="identity-card-bottom"><span>{workspace.organization || config.primary(profile) || 'Your public identity'}</span><QRPreview url={url} /></div>
        </div>
        <div className="identity-presence-copy"><span className="eyebrow">Visiting card preview</span><h3>{url || 'Your public link is waiting'}</h3><p>{url ? 'A compact, shareable version of your identity is ready to be shaped in the studio.' : 'Claim a username to create a shareable website and QR-ready card.'}</p><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/visiting-card/overview`)}>Open card studio →</button></div>
      </div>
    </section>
  );
}

function AnalyticsTeaser({ identity, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const [state, setState] = idState({ status: 'loading', totals: null });
  idEffect(() => {
    let active = true;
    window.OV.services.analytics.getOverview({ compare: 'true' }).then((data) => {
      if (active) setState({ status: 'ready', totals: data?.totals || null });
    }).catch(() => { if (active) setState({ status: 'empty', totals: null }); });
    return () => { active = false; };
  }, []);
  const totals = state.totals;
  return (
    <section className="identity-analytics">
      <div className="identity-section-heading"><div><span className="eyebrow">04 / Signal</span><h2>Analytics overview</h2></div><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/analytics`)}>View full analytics →</button></div>
      {totals ? (
        <div className="identity-analytics-data"><div className="identity-analytics-primary"><span>Page views</span><strong>{totals.pageViews || 0}</strong><small>Published presence</small></div><div><span>Visitors</span><strong>{totals.visitors || 0}</strong></div><div><span>Link clicks</span><strong>{totals.linkClicks || 0}</strong></div><div><span>Engagement</span><strong>{totals.engagementEvents || 0}</strong></div></div>
      ) : (
        <div className="identity-analytics-empty"><div className="identity-sparkline"><span /><span /><span /><span /><span /><span /><span /></div><div><h3>{state.status === 'loading' ? 'Reading your signal…' : 'Your signal starts here'}</h3><p>{state.status === 'loading' ? 'Loading owner analytics.' : 'Publish your presence and visits, clicks, and engagement will appear here.'}</p></div></div>
      )}
    </section>
  );
}

function RecentActivity({ identity, profile, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  const items = identityResource(profile, identity).slice(0, 3);
  return (
    <section className="identity-activity">
      <div className="identity-section-heading"><div><span className="eyebrow">05 / Momentum</span><h2>Recent activity</h2></div></div>
      {items.length ? items.map((item, index) => <button className="identity-activity-row" key={item?._id || item?.id || index} onClick={() => onNavigate(`${config.basePath}/identity`)}><span>0{index + 1}</span><strong>{valueOrEmpty(config.workName(item)) || 'Profile item updated'}</strong><small>Identity record</small><i>↗</i></button>) : <div className="identity-activity-empty"><p>No activity yet. Your next edit will appear here.</p><button className="identity-text-action" onClick={() => onNavigate(`${config.basePath}/identity`)}>Make an update →</button></div>}
    </section>
  );
}

function QuickActions({ identity, onNavigate }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity];
  return (
    <aside className="identity-quick-actions">
      <span className="eyebrow">Quick actions</span>
      <button onClick={() => onNavigate(`${config.basePath}/identity`)}><span>01</span><strong>Add identity detail</strong><i>↗</i></button>
      <button onClick={() => onNavigate(`${config.basePath}/visiting-card/overview`)}><span>02</span><strong>Design visiting card</strong><i>↗</i></button>
      <button onClick={() => onNavigate(`${config.basePath}/website`)}><span>03</span><strong>Shape my website</strong><i>↗</i></button>
    </aside>
  );
}

function SharedIdentityOverview({ identity, profile, websiteConfig, session, onNavigate }) {
  return (
    <div className={`identity-dashboard identity-dashboard-${identity}`}>
      <IdentityHero identity={identity} profile={profile} session={session} websiteConfig={websiteConfig} onNavigate={onNavigate} />
      <MetricRail identity={identity} profile={profile} />
      <div className="identity-main-grid">
        <div className="identity-main-column">
          <CompletionPanel identity={identity} profile={profile} onNavigate={onNavigate} />
          <WorkShelf identity={identity} profile={profile} onNavigate={onNavigate} />
          <PresencePanel identity={identity} profile={profile} session={session} onNavigate={onNavigate} />
          <AnalyticsTeaser identity={identity} onNavigate={onNavigate} />
        </div>
        <div className="identity-side-column"><QuickActions identity={identity} onNavigate={onNavigate} /><RecentActivity identity={identity} profile={profile} onNavigate={onNavigate} /></div>
      </div>
    </div>
  );
}

function SharedIdentityDashboard({ identity, session }) {
  const config = IDENTITY_DASHBOARD_CONFIG[identity] || IDENTITY_DASHBOARD_CONFIG.professional;
  const location = idLocation();
  const navigate = idNavigate();
  const [profile, setProfile] = idState(null);
  const [websiteConfig, setWebsiteConfig] = idState(null);
  const [loading, setLoading] = idState(true);
  const loadData = idCallback(async () => {
    setLoading(true);
    try {
      const token = session?.token || window.OV?.core?.db?.get('session')?.token;
      if (tokenIsExpired(token)) {
        await window.OV?.services?.auth?.signOut();
        navigate('/login', { replace: true });
        return;
      }
      const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
      if (identity === 'student') {
        const response = token && await fetch(`${apiBase}/${config.profileEndpoint}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = response?.ok ? await response.json() : null;
        setProfile(data?.profile || null);
      } else {
        const data = await window.OV.services.domainProfile.getIdentityProfile(identity);
        setProfile(data?.profile || null);
      }
      if (token) {
        const response = await fetch(`${apiBase}/student/website/config`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok) setWebsiteConfig((await response.json())?.config || null);
      }
    } catch (error) {
      console.warn(`Could not load ${identity} dashboard data:`, error);
    } finally {
      setLoading(false);
    }
  }, [config.profileEndpoint, identity, session]);

  idEffect(() => { loadData(); }, [loadData]);

  const activeNav = idMemo(() => {
    const path = location.pathname.toLowerCase();
    if (path.includes(`${config.basePath}/profile`)) return 'profile';
    if (path.includes(`${config.basePath}/identity`)) return 'identity';
    if (path.includes(`${config.basePath}/visiting-card`)) return 'visiting-card';
    if (path.includes(`${config.basePath}/analytics`)) return 'analytics';
    if (path.includes(`${config.basePath}/website/preview`)) return 'website-preview';
    if (path.includes(`${config.basePath}/website`)) return 'website';
    return 'overview';
  }, [config.basePath, location.pathname]);

  const saveProfile = async (payload) => {
    if (identity === 'student') {
      const token = session?.token || window.OV?.core?.db?.get('session')?.token;
      const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
      const response = await fetch(`${apiBase}/student/profile`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.ok) setProfile((await response.json()).profile || profile);
      return response.ok;
    }
    const data = await window.OV.services.domainProfile.updateIdentityProfile(identity, payload);
    setProfile(data?.profile || profile);
    return true;
  };

  const renderPage = () => {
    if (loading && !profile) return <div className="identity-loading glass"><span className="identity-loading-mark" /><p>Composing your {config.label.toLowerCase()} workspace…</p></div>;
    if (activeNav === 'overview') return <SharedIdentityOverview identity={identity} profile={profile} websiteConfig={websiteConfig} session={session} onNavigate={navigate} />;
    if (activeNav === 'identity') {
      const Editor = window[identity === 'student' ? 'StudentIdentityPage' : `${identity[0].toUpperCase()}${identity.slice(1)}IdentityPage`];
      return Editor ? <Editor session={session} studentProfile={profile} onSaveToDb={saveProfile} onProfileReplaced={setProfile} onSaved={setProfile} loadingProfile={loading} /> : null;
    }
    if (activeNav === 'profile' && identity === 'student' && window.StudentProfilePage) return <window.StudentProfilePage session={session} />;
    const workspace = mappedWorkspace(identity, profile, session?.user);
    if (activeNav === 'visiting-card' && window.StudentVisitingCardPage) {
      const card = identity === 'student' ? profile : window.OV.identityWorkspace.toCardProfile(identity, profile, session?.user);
      return <window.StudentVisitingCardPage session={session} studentProfile={card} basePath={config.basePath} />;
    }
    if (activeNav === 'analytics' && window.StudentAnalyticsPage) return <window.StudentAnalyticsPage session={session} />;
    if (activeNav === 'website-preview' && window.StudentWebsiteFullPreviewPage) return <window.StudentWebsiteFullPreviewPage session={session} studentProfile={workspace} basePath={config.basePath} />;
    if (activeNav === 'website' && window.StudentWebsitePage) return <window.StudentWebsitePage session={session} studentProfile={workspace} basePath={config.basePath} />;
    return <SharedIdentityOverview identity={identity} profile={profile} websiteConfig={websiteConfig} session={session} onNavigate={navigate} />;
  };

  return (
    <div className="identity-workspace-root">
      <SharedFloatingNavigation identity={identity} session={session} activeNav={activeNav} onNavigate={navigate} />
      <main id="main" className="identity-workspace-main">{renderPage()}</main>
    </div>
  );
}

window.IDENTITY_DASHBOARD_CONFIG = IDENTITY_DASHBOARD_CONFIG;
window.SharedIdentityDashboard = SharedIdentityDashboard;
