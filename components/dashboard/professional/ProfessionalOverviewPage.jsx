/* Hooks bindings */
const { useState: proOvState } = React;
const ProfessionalOverviewIcons = window.StudentIcons || {};

const PROFESSIONAL_OVERVIEW = {
  eyebrow: 'Career Overview',
  fallbackName: 'Professional',
  tagline: 'Verified work experience, career milestones, credentials, and skills.',
  audience: 'recruiter',
  templateLabel: 'RECRUITER / HIRING VIEW',
  viewLabel: 'Test Recruiter View',
  checklist: [
    { id: 'exp', label: 'Add current role & employer history' },
    { id: 'achieve', label: 'Document measurable career achievements' },
    { id: 'skills', label: 'List core professional competencies' },
    { id: 'cert', label: 'Attach verified employment credentials' },
    { id: 'share', label: 'Publish and share your Recruiter view' },
  ],
};

function proOverviewSnapshot(workspace) {
  const p = workspace || {};
  const projects = Array.isArray(p.projects) ? p.projects : [];
  const skills = Array.isArray(p.skills) ? p.skills : [];
  return [
    { label: 'Current Role', value: p.role || 'Not specified yet', sub: p.organization ? 'at ' + p.organization : 'Add your current employer' },
    { label: 'Primary Template', value: 'Recruiter / Hiring View', sub: 'Hiring-ready profile layout' },
    { label: 'Skills & Portfolio', value: skills.length + ' skills', sub: projects.length + ' portfolio items' },
  ];
}

/* =========================================================================
   Professional Overview Page
   ========================================================================= */
function ProfessionalOverviewPage({ session, workspaceProfile, websiteConfig, onNavigateSection }) {
  const toast = useToast();
  const config = PROFESSIONAL_OVERVIEW;
  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : '';
  const viewUrl = session?.user?.username ? `/#/${session.user.username}/${config.audience}` : '';

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_professional`;
  const [checkedItems, setCheckedItems] = proOvState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleCheck = (itemId) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const progressPercent = Math.round(
    (config.checklist.filter((item) => checkedItems[item.id]).length / config.checklist.length) * 100
  );

  const websiteStatus = websiteConfig?.status === 'published'
    ? 'Published'
    : websiteConfig?.status === 'suspended'
      ? 'Suspended'
      : websiteConfig
        ? 'Draft'
        : 'Not published';

  const copyPublicLink = async () => {
    if (!publicUrl) {
      toast.push({ title: 'No public link', body: 'Claim a username before sharing. This identity profile is not published.', tone: 'info' });
      return;
    }
    await copyText('https://' + publicUrl);
    toast.push({ title: 'Link copied', body: publicUrl, tone: 'success' });
  };

  const openPublicView = () => {
    if (!viewUrl) {
      toast.push({ title: 'Profile is private', body: 'This identity profile stays private until a publishing flow releases it.', tone: 'info' });
      return;
    }
    window.open(viewUrl, '_blank');
  };

  const snapshot = proOverviewSnapshot(workspaceProfile);

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <section className="glass" style={{ padding: '28px 32px', borderRadius: 24, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>{config.eyebrow}</span>
            <h1 className="h-card" style={{ fontSize: 32, margin: '6px 0 4px' }}>
              Welcome, {session?.user?.name || config.fallbackName}
            </h1>
            <p className="muted" style={{ fontSize: 15, margin: 0, maxWidth: 600 }}>
              {config.tagline}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button size="sm" variant="glass" icon={<ProfessionalOverviewIcons.share />} onClick={copyPublicLink}>
              Copy link
            </Button>
            <Button size="sm" variant="glass" onClick={openPublicView}>
              Preview public view
            </Button>
            <Button size="sm" variant="primary" onClick={() => onNavigateSection('/app/professional/identity')}>
              Edit Identity
            </Button>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
        {snapshot.map((card) => (
          <div key={card.label} className="glass" style={{ padding: 20, borderRadius: 18 }}>
            <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>{card.label}</span>
            <h3 style={{ fontSize: 20, margin: '6px 0 2px' }}>{card.value}</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>{card.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Profile Completion Checklist</h2>
            <span className="mono" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{progressPercent}%</span>
          </div>

          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: 'var(--accent)',
                borderRadius: 999,
                transition: 'width .35s ease',
              }}
            />
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {config.checklist.map((item) => {
              const done = !!checkedItems[item.id];
              return (
                <li
                  key={item.id}
                  onClick={() => toggleCheck(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: done ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : 'transparent',
                    transition: 'background .2s',
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      border: done ? 'none' : '1.5px solid var(--line-hi)',
                      background: done ? 'var(--accent)' : 'transparent',
                      color: '#17130A',
                      display: 'grid',
                      placeItems: 'center',
                      flex: 'none',
                    }}
                  >
                    {done && <Icon.check width="11" height="11" />}
                  </div>
                  <span style={{ fontSize: 13.5, color: done ? 'var(--text-1)' : 'var(--text-2)', textDecoration: done ? 'line-through' : 'none' }}>
                    {item.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
          <h2 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Template Selection & Status</h2>

          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13.5 }}>Website status</span>
              <Badge><span className="badge-dot" /> {websiteStatus}</Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13.5 }}>Audience template</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>{config.templateLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13.5 }}>Custom link</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{publicUrl}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" variant="glass" block onClick={openPublicView}>
              {config.viewLabel}
            </Button>
            <Button size="sm" variant="glass" block onClick={copyPublicLink}>
              Share Link
            </Button>
            <Button size="sm" variant="primary" block onClick={() => onNavigateSection('/app/professional/website')}>
              Manage Website
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
window.ProfessionalOverviewPage = ProfessionalOverviewPage;
