/* =========================================================================
   OneVue — Business Identity Dashboard
   Domain: Business
   Route: /app/business
   ========================================================================= */

const { useState: busState, useEffect: busEffect, useMemo: busMemo } = React;

function BusinessDashboard({ session }) {
  const toast = useToast();

  // Tab & Customization State
  const [activeTab, setActiveTab] = busState('overview');
  const [name, setName] = busState(session?.user?.name || '');
  const [theme, setTheme] = busState(window.OV?.theme?.get ? window.OV.theme.get() : 'sapphire');

  // Business Configuration & Checklist
  const busConfig = {
    id: 'business',
    title: 'Business Dashboard',
    badge: 'Organization',
    glyph: 'V',
    defaultAudience: 'recruiter',
    tagline: 'Company identity, B2B offerings, branding, and contact points.',
    checklist: [
      { id: 'org', label: 'Complete organization overview & mission' },
      { id: 'offerings', label: 'Detail key products & client solutions' },
      { id: 'brand', label: 'Upload brand assets and one-pager deck' },
      { id: 'legal', label: 'Attach registration number & credentials' },
      { id: 'share', label: 'Publish and share your Partner view' },
    ],
  };

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_business`;
  const [checkedItems, setCheckedItems] = busState(() => {
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

  const progressPercent = busMemo(() => {
    const total = busConfig.checklist.length;
    const completed = busConfig.checklist.filter(item => checkedItems[item.id]).length;
    return Math.round((completed / total) * 100);
  }, [busConfig, checkedItems]);

  const [savingAccount, setSavingAccount] = proState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (savingAccount) return;
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      toast.push({ title: "Profile was not saved", body: "Display name cannot be empty.", tone: "error" });
      return;
    }
    setSavingAccount(true);
    try {
      if (!window.OV?.services?.domainProfile?.updateAccountName) {
        throw new Error("Profile service is unavailable.");
      }
      await window.OV.services.domainProfile.updateAccountName(trimmed);
      toast.push({ title: "Profile saved", body: "Account name updated.", tone: "success" });
    } catch (err) {
      toast.push({
        title: "Profile was not saved",
        body: err?.message || "The server did not confirm this change.",
        tone: "error",
      });
    } finally {
      setSavingAccount(false);
    }
  };

  const saveTheme = (t) => {
    if (window.OV?.theme?.set) {
      window.OV.theme.set(t);
      setTheme(t);
      toast.push({ title: 'Theme updated', tone: 'success' });
    }
  };

  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : '';
  const viewUrl = session?.user?.username ? `/#/${session.user.username}/recruiter` : '';

  return (
    <main id="main" className="wrap" style={{ paddingTop: 90, paddingBottom: 100, minHeight: '85vh' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 32 }}>

        {/* Business Banner Header */}
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
                  <h1 className="h-card" style={{ fontSize: 28, margin: 0 }}>{session?.user?.name || 'Business'}</h1>
                  <span className="badge badge-verified" style={{ letterSpacing: '.04em' }}>
                    <span className="serif" style={{ marginRight: 4, fontWeight: 600 }}>{busConfig.glyph}</span> {busConfig.badge}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                  {busConfig.tagline}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="sm" variant="glass" icon={<Icon.copy />} onClick={async () => {
                if (!publicUrl) { toast.push({ title: 'No public link', body: 'Claim a username before sharing. This identity profile is not published.', tone: 'info' }); return; }
                await copyText('https://' + publicUrl);
                toast.push({ title: 'Link copied', body: publicUrl, tone: 'success' });
              }}>
                Copy link
              </Button>
              <Button size="sm" variant="accent" onClick={() => { if (!viewUrl) { toast.push({ title: 'Profile is private', body: 'This identity profile stays private until a publishing flow releases it.', tone: 'info' }); return; } window.open(viewUrl, '_blank'); }}>
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
              Organization & Offerings Overview
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

        <div style={{ display: activeTab === 'overview' ? 'grid' : 'none', gap: 24 }}>
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
                  {busConfig.checklist.map(item => {
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
                    <Badge><span className="badge-dot" /> Not published</Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Audience template</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-1)' }}>ENTERPRISE & PARTNER VIEW</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted" style={{ fontSize: 13.5 }}>Custom link</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{publicUrl}</span>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="glass" block onClick={() => { if (!viewUrl) { toast.push({ title: 'Profile is private', body: 'This identity profile stays private until a publishing flow releases it.', tone: 'info' }); return; } window.open(viewUrl, '_blank'); }}>
                    Test Partner View
                  </Button>
                  <Button size="sm" variant="primary" block onClick={async () => {
                    if (!publicUrl) { toast.push({ title: 'No public link', body: 'Claim a username before sharing. This identity profile is not published.', tone: 'info' }); return; }
                await copyText('https://' + publicUrl);
                    toast.push({ title: 'Copied', body: 'Username link copied. This identity profile is still private.', tone: 'success' });
                  }}>
                    Share Link
                  </Button>
                </div>
              </section>
            </div>

                        <IdentityProfileEditor identity="business" />
        </div>
        {activeTab === 'settings' ? (
          /* Settings Tab */
          <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
            <section className="glass" style={{ padding: 28, borderRadius: 20 }}>
              <h2 className="h-sub" style={{ marginBottom: 16 }}>Profile Information</h2>
              <form onSubmit={saveProfile} style={{ display: 'grid', gap: 18 }}>
                <Input
                  label="Account display name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  hint="Organization details are saved in the overview. This updates the account display name."
                />
                <Input
                  label="Saved Identity"
                  value="BUSINESS"
                  disabled
                  hint="Your identity type was established during registration."
                />
                <Input
                  label="Assigned Dashboard"
                  value="/app/business"
                  disabled
                  hint="Automatic route resolved for your account."
                />
                <Button type="submit" variant="primary" loading={savingAccount} disabled={savingAccount} style={{ justifySelf: 'start' }}>Save Information</Button>
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
        ) : null}


      </div>
    </main>
  );
}

window.BusinessDashboard = BusinessDashboard;
