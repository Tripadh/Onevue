/* =========================================================================
   OneVue — Freelancer Identity Dashboard
   Domain: Freelancer
   Route: /app/freelancer
   ========================================================================= */

const { useState: freeState, useEffect: freeEffect, useMemo: freeMemo } = React;

function FreelancerDashboard({ session }) {
  const toast = useToast();
  const [serviceModal, setServiceModal] = freeState(false);

  // Tab & Customization State
  const [activeTab, setActiveTab] = freeState('overview');
  const [name, setName] = freeState(session?.user?.name || '');
  const [theme, setTheme] = freeState(window.OV?.theme?.get ? window.OV.theme.get() : 'sapphire');

  // Freelancer Configuration & Checklist
  const freeConfig = {
    id: 'freelancer',
    title: 'Freelancer Dashboard',
    badge: 'Independent Pro',
    glyph: 'III',
    defaultAudience: 'client',
    tagline: 'Client-facing services, deliverables, pricing tiers, and portfolio.',
    checklist: [
      { id: 'services', label: 'Define service packages & rate cards' },
      { id: 'case_studies', label: 'Add client case studies with metrics' },
      { id: 'skills', label: 'List domain specializations & tooling' },
      { id: 'reviews', label: 'Collect client testimonials & ratings' },
      { id: 'share', label: 'Publish and share your Client view' },
    ],
  };

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_freelancer`;
  const [checkedItems, setCheckedItems] = freeState(() => {
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

  const progressPercent = freeMemo(() => {
    const total = freeConfig.checklist.length;
    const completed = freeConfig.checklist.filter(item => checkedItems[item.id]).length;
    return Math.round((completed / total) * 100);
  }, [freeConfig, checkedItems]);

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

  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : 'onevue.id/freelancer.demo';
  const viewUrl = session?.user?.username ? `/#/${session.user.username}/client` : '/#/amara/client';

  return (
    <main id="main" className="wrap" style={{ paddingTop: 90, paddingBottom: 100, minHeight: '85vh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 32 }}>

        {/* Freelancer Banner Header */}
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
                  <h1 className="h-card" style={{ fontSize: 28, margin: 0 }}>{session?.user?.name || 'Freelancer'}</h1>
                  <span className="badge badge-verified" style={{ letterSpacing: '.04em' }}>
                    <span className="serif" style={{ marginRight: 4, fontWeight: 600 }}>{freeConfig.glyph}</span> {freeConfig.badge}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {freeConfig.tagline}
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
              Services & Portfolio Overview
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
                  {freeConfig.checklist.map(item => {
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
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>CLIENT / PITCH VIEW</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Custom link</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{publicUrl}</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="glass" block onClick={() => window.open(viewUrl, '_blank')}>
                    Test Client View
                  </Button>
                  <Button size="sm" variant="primary" block onClick={async () => {
                    await copyText('https://' + publicUrl);
                    toast.push({ title: 'Copied', body: 'Ready to share with prospective clients', tone: 'success' });
                  }}>
                    Share Link
                  </Button>
                </div>
              </section>
            </div>

            {/* Freelancer Content Sections */}
            <div style={{ display: 'grid', gap: 24 }}>
              {/* Freelancer Overview Banner */}
              <GlassCard style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="h-card" style={{ fontSize: 20, margin: 0 }}>Freelance Practice Overview</h2>
                  <Badge tone="verified">Availability: Open for Select Projects</Badge>
                </div>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Tailored for direct client booking, agency pitches, and consulting engagements. Features service packages, rates, and verified deliverables.
                </p>
              </GlassCard>

              {/* Services & Pricing */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Services & Pricing Tiers</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Offerings, deliverables, fixed scopes, and turnaround times</p>
                  </div>
                  <Button size="sm" variant="glass" icon={<Icon.plus />} onClick={() => setServiceModal(true)}>Add Service</Button>
                </div>

                <EmptyState
                  title="No services configured"
                  body="Define package names (e.g., 'Brand Identity Sprint'), baseline pricing, and timeline."
                  action={<Button size="sm" variant="primary" onClick={() => setServiceModal(true)}>+ Add Service Package</Button>}
                />
              </section>

              {/* Portfolio & Case Studies */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Portfolio & Client Case Studies</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Visual proof of shipped work and verified metrics</p>
                  </div>
                  <Button size="sm" variant="glass" icon={<Icon.plus />} onClick={() => toast.push({ title: 'Add Case Study', tone: 'info' })}>Add Case Study</Button>
                </div>

                <EmptyState
                  title="No case studies added"
                  body="Present past work with real outcomes (e.g. '+45% conversion uplift for FinTech client')."
                />
              </section>

              {/* Two Column: Skills & Testimonials */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Domain Specialization</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Core client offerings, tools, and platforms.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge">UI/UX Systems</span>
                    <span className="badge">Next.js Development</span>
                    <span className="badge">Design Systems</span>
                    <span className="badge">Conversion Strategy</span>
                  </div>
                </section>

                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Client Testimonials & Reviews</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Verified feedback from past clients.</p>
                  <EmptyState
                    title="No reviews collected"
                    body="Request testimonials directly to build trust with new prospects."
                    action={<Button size="sm" variant="glass" onClick={() => toast.push({ title: 'Review link generated', tone: 'info' })}>Request Review</Button>}
                  />
                </section>
              </div>
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
                  value="FREELANCER"
                  disabled
                  hint="Your identity type was established during registration."
                />
                <Input
                  label="Assigned Dashboard"
                  value="/app/freelancer"
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
        <Modal open={serviceModal} onClose={() => setServiceModal(false)} title="Add Service Package">
          <div style={{ display: 'grid', gap: 16 }}>
            <h3 className="h-card" style={{ fontSize: 22 }}>New Service</h3>
            <Input label="Service Name" placeholder="e.g. Design System Sprint" />
            <Input label="Starting Rate" placeholder="e.g. $2,500" />
            <Input label="Estimated Turnaround" placeholder="e.g. 2 weeks" />
            <Input label="Deliverables" placeholder="Figma tokens, React components, documentation" />
            <Button block onClick={() => { setServiceModal(false); toast.push({ title: 'Service saved', tone: 'success' }); }}>Save Service</Button>
          </div>
        </Modal>

      </div>
    </main>
  );
}

window.FreelancerDashboard = FreelancerDashboard;
