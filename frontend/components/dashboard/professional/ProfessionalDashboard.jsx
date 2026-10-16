/* =========================================================================
   OneVue — Professional Identity Dashboard
   Domain: Professional
   Route: /app/professional
   ========================================================================= */

const { useState: proState, useEffect: proEffect, useMemo: proMemo } = React;

function ProfessionalDashboard({ session }) {
  const toast = useToast();
  const [expModal, setExpModal] = proState(false);

  // Tab & Customization State
  const [activeTab, setActiveTab] = proState('overview');
  const [name, setName] = proState(session?.user?.name || '');
  const [theme, setTheme] = proState(window.OV?.theme?.get ? window.OV.theme.get() : 'sapphire');

  // Professional Configuration & Checklist
  const proConfig = {
    id: 'professional',
    title: 'Professional Dashboard',
    badge: 'Career Path',
    glyph: 'II',
    defaultAudience: 'recruiter',
    tagline: 'Verified work experience, career milestones, credentials, and skills.',
    checklist: [
      { id: 'exp', label: 'Add current role & employer history' },
      { id: 'achieve', label: 'Document measurable career achievements' },
      { id: 'skills', label: 'List core professional competencies' },
      { id: 'cert', label: 'Attach verified employment credentials' },
      { id: 'share', label: 'Publish and share your Recruiter view' },
    ],
  };

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_professional`;
  const [checkedItems, setCheckedItems] = proState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleCheck = (itemId) => {
    setCheckedItems(prev => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const progressPercent = proMemo(() => {
    const total = proConfig.checklist.length;
    const completed = proConfig.checklist.filter(item => checkedItems[item.id]).length;
    return Math.round((completed / total) * 100);
  }, [proConfig, checkedItems]);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (session?.user?.id && window.OV?.services?.profile?.updateMyProfile) {
      await window.OV.services.profile.updateMyProfile(session.user.id, { name }).catch(() => {});
    }
    toast.push({ title: 'Profile saved', body: 'Changes updated successfully', tone: 'success' });
  };

  const saveTheme = (t) => {
    if (window.OV?.theme?.set) {
      window.OV.theme.set(t);
      setTheme(t);
      toast.push({ title: 'Theme updated', tone: 'success' });
    }
  };

  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : 'onevue.id/professional.demo';
  const viewUrl = session?.user?.username ? `/#/${session.user.username}/recruiter` : '/#/amara/recruiter';

  return (
    <main id="main" className="wrap" style={{ paddingTop: 90, paddingBottom: 100, minHeight: '85vh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 32 }}>

        {/* Professional Banner Header */}
        <header className="glass" style={{ padding: '28px 32px', borderRadius: 24, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <Avatar
                initials={(session?.user?.name || 'U').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                size={54}
                ring
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 className="h-card" style={{ fontSize: 28, margin: 0 }}>{session?.user?.name || 'Professional'}</h1>
                  <span className="badge badge-verified" style={{ letterSpacing: '.04em' }}>
                    <span className="serif" style={{ marginRight: 4, fontWeight: 600 }}>{proConfig.glyph}</span> {proConfig.badge}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {proConfig.tagline}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="sm" variant="glass" icon={<Icon.copy />} onClick={async () => {
                await copyText('https://' + publicUrl);
                toast.push({ title: 'Link copied', body: publicUrl, tone: 'success' });
              }}>
                Copy link
              </Button>
              <Button size="sm" variant="accent" onClick={() => window.open(viewUrl, '_blank')}>
                Preview public view
              </Button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div style={{ display: 'flex', borderTop: '1px solid var(--line)', paddingTop: 16, gap: 10 }}>
            <Button
              size="sm"
              variant={activeTab === 'overview' ? 'primary' : 'ghost'}
              onClick={() => setActiveTab('overview')}
            >
              Career Overview & Content
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'settings' ? 'primary' : 'ghost'}
              onClick={() => setActiveTab('settings')}
            >
              Account & Theme Settings
            </Button>
          </div>
        </header>

        {activeTab === 'overview' ? (
          <>
            {/* Top Grid: Onboarding Checklist & Publishing Status */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
              
              {/* Checklist Card */}
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
                  {proConfig.checklist.map(item => {
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

              {/* Template & Publishing Status Card */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <h2 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Template Selection & Status</h2>
                
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Publishing status</span>
                    <Badge tone="verified"><span className="badge-dot" /> Live on OneVue</Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Audience template</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>RECRUITER / HIRING VIEW</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Custom link</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{publicUrl}</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="glass" block onClick={() => window.open(viewUrl, '_blank')}>
                    Test Recruiter View
                  </Button>
                  <Button size="sm" variant="primary" block onClick={async () => {
                    await copyText('https://' + publicUrl);
                    toast.push({ title: 'Copied', body: 'Ready to share with recruiters', tone: 'success' });
                  }}>
                    Share Link
                  </Button>
                </div>
              </section>
            </div>

            {/* Professional Content Blocks */}
            <div style={{ display: 'grid', gap: 24 }}>
              {/* Professional Overview Banner */}
              <GlassCard style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="h-card" style={{ fontSize: 20, margin: 0 }}>Career Overview</h2>
                  <Badge tone="verified">Career Verification: Enabled</Badge>
                </div>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Designed for career recruiters, hiring managers, and professional networks. Highlights employment tenure, career impact, and vetted skills.
                </p>
              </GlassCard>

              {/* Work Experience */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Work Experience & Employment</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Roles, organizations, employment dates, and key accomplishments</p>
                  </div>
                  <Button size="sm" variant="glass" icon={<Icon.plus />} onClick={() => setExpModal(true)}>Add Position</Button>
                </div>

                <EmptyState
                  title="No work history added yet"
                  body="Add your current and previous professional roles to demonstrate experience and career progression."
                  action={<Button size="sm" variant="primary" onClick={() => setExpModal(true)}>+ Add Work Experience</Button>}
                />
              </section>

              {/* Two Column: Career Achievements & Skills */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Career Achievements & Impact</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Measurable results, team leadership milestones, and promotions.</p>
                  <EmptyState
                    title="No milestones recorded"
                    body="Document quantifiable milestones (e.g., revenue growth, system optimizations)."
                    action={<Button size="sm" variant="glass" onClick={() => toast.push({ title: 'Milestone added', tone: 'info' })}>+ Add Achievement</Button>}
                  />
                </section>

                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Skills & Professional Qualifications</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Validated technical proficiencies, management capabilities, and tools.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge">Product Strategy</span>
                    <span className="badge">Engineering Leadership</span>
                    <span className="badge">Cross-Functional Delivery</span>
                    <span className="badge">System Architecture</span>
                  </div>
                </section>
              </div>

              {/* Certifications Card */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Industry Certifications & Credentials</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Verified licenses, cloud certifications, and compliance credentials</p>
                  </div>
                  <Button size="sm" variant="glass" icon={<Icon.plus />} onClick={() => toast.push({ title: 'Add credential modal', tone: 'info' })}>Add Credential</Button>
                </div>

                <EmptyState
                  title="No credentials on file"
                  body="Attach AWS, PMP, CPA, or other industry certifications with verification hashes."
                />
              </section>
            </div>
          </>
        ) : (
          /* Settings Tab */
          <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
            <section className="glass" style={{ padding: 28, borderRadius: 20 }}>
              <h2 className="h-sub" style={{ marginBottom: 16 }}>Profile Information</h2>
              <form onSubmit={saveProfile} style={{ display: 'grid', gap: 18 }}>
                <Input
                  label="Full Name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                <Input
                  label="Saved Identity"
                  value="PROFESSIONAL"
                  disabled
                  hint="Your identity type was established during registration."
                />
                <Input
                  label="Assigned Dashboard"
                  value="/app/professional"
                  disabled
                  hint="Automatic route resolved for your account."
                />
                <Button type="submit" variant="primary" style={{ justifySelf: 'start' }}>Save Information</Button>
              </form>
            </section>

            <section className="glass" style={{ padding: 28, borderRadius: 20 }}>
              <h2 className="h-sub" style={{ marginBottom: 16 }}>Theme Settings</h2>
              <p className="muted" style={{ marginBottom: 16, fontSize: 14 }}>Select a default theme token for your Onevue pages.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {window.OV?.theme?.list?.map(t => (
                  <Button
                    key={t.id}
                    variant={theme === t.id ? 'accent' : 'glass'}
                    onClick={() => saveTheme(t.id)}
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Modal */}
        <Modal open={expModal} onClose={() => setExpModal(false)} title="Add Work Experience">
          <div style={{ display: 'grid', gap: 16 }}>
            <h3 className="h-card" style={{ fontSize: 22 }}>Add Position</h3>
            <Input label="Job Title" placeholder="e.g. Senior Software Engineer" />
            <Input label="Company / Employer" placeholder="e.g. Stripe, Airbnb" />
            <Input label="Period" placeholder="e.g. 2022 — Present" />
            <Input label="Key Impact / Note" placeholder="Led infrastructure migration reducing latency by 28%" />
            <Button block onClick={() => { setExpModal(false); toast.push({ title: 'Position saved', tone: 'success' }); }}>Save Position</Button>
          </div>
        </Modal>

      </div>
    </main>
  );
}

window.ProfessionalDashboard = ProfessionalDashboard;
