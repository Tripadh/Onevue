/* =========================================================================
   OneVue — Creator Identity Dashboard
   Domain: Creator
   Route: /app/creator
   ========================================================================= */

const { useState: creState, useEffect: creEffect, useMemo: creMemo } = React;

function CreatorDashboard({ session }) {
  const toast = useToast();
  const [contentModal, setContentModal] = creState(false);

  // Tab & Customization State
  const [activeTab, setActiveTab] = creState('overview');
  const [name, setName] = creState(session?.user?.name || '');
  const [theme, setTheme] = creState(window.OV?.theme?.get ? window.OV.theme.get() : 'sapphire');

  // Creator Configuration & Checklist
  const creConfig = {
    id: 'creator',
    title: 'Creator Dashboard',
    badge: 'Media & Reach',
    glyph: 'IV',
    defaultAudience: 'client',
    tagline: 'Featured creations, connected channels, media kit, and collaborations.',
    checklist: [
      { id: 'bio', label: 'Set creator bio & primary content niche' },
      { id: 'content', label: 'Pin spotlight videos, posts, or media' },
      { id: 'channels', label: 'Connect social channels & reach stats' },
      { id: 'rates', label: 'Add media kit & sponsorship tiers' },
      { id: 'share', label: 'Publish and share your Media/Brand view' },
    ],
  };

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_creator`;
  const [checkedItems, setCheckedItems] = creState(() => {
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

  const progressPercent = creMemo(() => {
    const total = creConfig.checklist.length;
    const completed = creConfig.checklist.filter(item => checkedItems[item.id]).length;
    return Math.round((completed / total) * 100);
  }, [creConfig, checkedItems]);

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

  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : 'onevue.id/creator.demo';
  const viewUrl = session?.user?.username ? `/#/${session.user.username}/client` : '/#/amara/client';

  return (
    <main id="main" className="wrap" style={{ paddingTop: 90, paddingBottom: 100, minHeight: '85vh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 32 }}>

        {/* Creator Banner Header */}
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
                  <h1 className="h-card" style={{ fontSize: 28, margin: 0 }}>{session?.user?.name || 'Creator'}</h1>
                  <span className="badge badge-verified" style={{ letterSpacing: '.04em' }}>
                    <span className="serif" style={{ marginRight: 4, fontWeight: 600 }}>{creConfig.glyph}</span> {creConfig.badge}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {creConfig.tagline}
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
              Media Kit & Content Overview
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
                  {creConfig.checklist.map(item => {
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
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>MEDIA & BRAND VIEW</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Custom link</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{publicUrl}</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="glass" block onClick={() => window.open(viewUrl, '_blank')}>
                    Test Brand View
                  </Button>
                  <Button size="sm" variant="primary" block onClick={async () => {
                    await copyText('https://' + publicUrl);
                    toast.push({ title: 'Copied', body: 'Ready to share with sponsors and brands', tone: 'success' });
                  }}>
                    Share Link
                  </Button>
                </div>
              </section>
            </div>

            {/* Creator Content Blocks */}
            <div style={{ display: 'grid', gap: 24 }}>
              {/* Creator Overview Banner */}
              <GlassCard style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h2 className="h-card" style={{ fontSize: 20, margin: 0 }}>Creator Channel Overview</h2>
                  <Badge tone="verified">Media Kit Status: Published</Badge>
                </div>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Built for brand partners, sponsors, and community followers. Showcases top content, cross-platform reach, and collaboration terms.
                </p>
              </GlassCard>

              {/* Featured Content & Spotlights */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Featured Content & Spotlights</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Highlight top videos, podcasts, articles, or newsletter editions</p>
                  </div>
                  <Button size="sm" variant="glass" icon={<Icon.plus />} onClick={() => setContentModal(true)}>Feature Work</Button>
                </div>

                <EmptyState
                  title="No content featured yet"
                  body="Pin your highest-performing video, essay, or creative release."
                  action={<Button size="sm" variant="primary" onClick={() => setContentModal(true)}>+ Pin Featured Content</Button>}
                />
              </section>

              {/* Social Platforms & Connected Channels */}
              <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 16 }}>
                <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Connected Social Channels</h3>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>Audiences and platform links presented clearly to potential sponsors.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div className="glass" style={{ padding: 14, borderRadius: 12, display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>YouTube</span>
                    <span className="muted" style={{ fontSize: 12 }}>Channel connected</span>
                  </div>
                  <div className="glass" style={{ padding: 14, borderRadius: 12, display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Substack / Newsletter</span>
                    <span className="muted" style={{ fontSize: 12 }}>Publications linked</span>
                  </div>
                  <div className="glass" style={{ padding: 14, borderRadius: 12, display: 'grid', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>GitHub / Dev</span>
                    <span className="muted" style={{ fontSize: 12 }}>Open source repos</span>
                  </div>
                </div>
              </section>

              {/* Sponsorship Tiers & Media Kit */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Sponsorship Opportunities</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Standard packages for newsletter mentions, dedicated videos, and podcasts.</p>
                  <EmptyState
                    title="No tiers published"
                    body="Define flat-rate sponsorships and delivery specifications."
                    action={<Button size="sm" variant="glass" onClick={() => toast.push({ title: 'Add tier', tone: 'info' })}>+ Add Sponsorship Tier</Button>}
                  />
                </section>

                <section className="glass" style={{ padding: 24, borderRadius: 20, display: 'grid', gap: 14 }}>
                  <h3 className="h-sub" style={{ fontSize: 18, margin: 0 }}>Audience Demographics</h3>
                  <p className="muted" style={{ fontSize: 13 }}>Verified subscriber totals, engagement metrics, and geographic spread.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge">Engineering Audience</span>
                    <span className="badge">North America (62%)</span>
                    <span className="badge">4.2% Avg Clickthrough</span>
                  </div>
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
                  value="CREATOR"
                  disabled
                  hint="Your identity type was established during registration."
                />
                <Input
                  label="Assigned Dashboard"
                  value="/app/creator"
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
        <Modal open={contentModal} onClose={() => setContentModal(false)} title="Feature Content">
          <div style={{ display: 'grid', gap: 16 }}>
            <h3 className="h-card" style={{ fontSize: 22 }}>Feature Media</h3>
            <Input label="Title" placeholder="e.g. Building an Agentic OS in 24h" />
            <Input label="Platform / Channel" placeholder="e.g. YouTube / Podcast" />
            <Input label="Media URL" placeholder="https://..." />
            <Button block onClick={() => { setContentModal(false); toast.push({ title: 'Content featured', tone: 'success' }); }}>Save Spotlight</Button>
          </div>
        </Modal>

      </div>
    </main>
  );
}

window.CreatorDashboard = CreatorDashboard;
