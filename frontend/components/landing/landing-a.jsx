/* Landing — part A: hero, problem, how it works, profile types, audience demo. */
const { useState: laUseState, useEffect: laUseEffect } = React;
const SA = window.OV.services;

function Hero({ onPickOnevue }) {
  const { openAuth } = useApp();
  return (
    <section className="hero" id="top" data-screen-label="Hero">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <Reveal><span className="eyebrow">Your professional identity, verified</span></Reveal>
          <Reveal delay={.06}><h1 className="h-display">One identity.<br /><span className="italic metal-text">Every view.</span></h1></Reveal>
          <Reveal delay={.12}><p className="lede">Fill in your profile once. Share a recruiter view, a client view, a college view — each showing only what that audience needs, each backed by credentials checked at the source.</p></Reveal>
          <Reveal delay={.18}><UrlClaimer /></Reveal>
          <Reveal delay={.24} className="hero-ctas">
            <Button variant="glass" onClick={() => scrollToId('views')} icon={<Icon.arrow />}>See the views in action</Button>
            <button className="btn btn-ghost" onClick={() => openAuth('signin')}>I already have one</button>
          </Reveal>
        </div>
        <Reveal delay={.1} className="hero-visual" y={0}>
          <HeroGem onPick={onPickOnevue} />
          <p className="gem-caption faint">Hover a onevue. Click to preview that view.</p>
        </Reveal>
      </div>
    </section>
  );
}

const SCATTER = [
  { k: 'LinkedIn', v: 'Work history, but no rates' },
  { k: 'Portfolio site', v: 'Case studies, no credentials' },
  { k: 'PDF résumé', v: 'Out of date the day you send it' },
  { k: 'Transcripts', v: 'Scanned, unverifiable' },
  { k: 'Business card', v: 'A phone number, nothing more' },
  { k: 'Email signature', v: 'Three links, none complete' },
];

function Problem() {
  return (
    <section className="section" id="problem" data-screen-label="Problem">
      <div className="wrap problem-grid">
        <div className="section-head">
          <Reveal><span className="eyebrow">The problem</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">You are not six links.</h2></Reveal>
          <Reveal delay={.1}><p className="lede">Every audience asks for a different version of you, so you keep a different file for each one. They drift, contradict each other, and none of them can prove what they say.</p></Reveal>
        </div>
        <div className="scatter" aria-label="Scattered profiles">
          {SCATTER.map((s, i) => (
            <Reveal key={s.k} delay={i * .06} className="scatter-item" style={{ '--r': ((i % 2 ? 1 : -1) * (1.5 + i * .4)).toFixed(1) + 'deg' }}>
              <GlassCard className="scatter-card lift">
                <span className="scatter-k">{s.k}</span>
                <span className="faint">{s.v}</span>
              </GlassCard>
            </Reveal>
          ))}
          <div className="scatter-merge" aria-hidden="true"><span className="brand-mark"><span /></span></div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { n: '01', t: 'Fill it once', b: 'Add your experience, education, work, services and links in one place. Import from your résumé to start in minutes.' },
  { n: '02', t: 'Verify what matters', b: 'Connect degrees, employers and certifications. We confirm each with the issuer and seal it with a signed record.' },
  { n: '03', t: 'Share the right view', b: 'Send onevue.id/you, a QR code, or an audience link. Each onevue reveals only the sections you’ve allowed.' },
];

function HowItWorks() {
  return (
    <section className="section" id="how" data-screen-label="How it works">
      <div className="wrap">
        <div className="section-head center">
          <Reveal><span className="eyebrow">How it works</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Three steps, then never again.</h2></Reveal>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * .1} className="step">
              <GlassCard tilt className="step-card">
                <span className="step-n serif">{s.n}</span>
                <h3 className="h-card">{s.t}</h3>
                <p className="muted">{s.b}</p>
              </GlassCard>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ProfileTypes() {
  const { data: types } = useAsync(() => SA.profile.listProfileTypes(), []);
  return (
    <section className="section" id="types" data-screen-label="Profile types">
      <div className="wrap">
        <div className="section-head">
          <Reveal><span className="eyebrow">Built for every path</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Five profile types.<br /><span className="italic muted">One way of working.</span></h2></Reveal>
          <Reveal delay={.1}><p className="lede">Choose the type that fits where you are. Each comes with the sections its audiences expect — and you can switch as your career moves.</p></Reveal>
        </div>
        <div className="types">
          {(types || Array.from({ length: 5 }, (_, i) => ({ id: 'sk' + i }))).map((t, i) => (
            <Reveal key={t.id} delay={i * .07} className="type-wrap">
              <GlassCard tilt max={9} className="type-card">
                {t.name ? (
                  <>
                    <span className="type-glyph serif">{t.glyph}</span>
                    <h3 className="h-card">{t.name}</h3>
                    <p className="muted">{t.line}</p>
                    <ul className="type-secs">{t.sections.map(s => <li key={s}>{s}</li>)}</ul>
                  </>
                ) : (<><Skeleton w={40} h={28} /><Skeleton w="60%" h={26} style={{ marginTop: 40 }} /><Skeleton h={12} style={{ marginTop: 14 }} /><Skeleton w="80%" h={12} style={{ marginTop: 8 }} /></>)}
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const DEMO_ONEVUES = ['recruiter', 'client', 'college'];

function AudienceDemo({ onevue, setOnevue }) {
  const { data: profile } = useAsync(() => SA.profile.getDemoProfile(), []);
  const { data: onevues } = useAsync(() => SA.onevues.listOnevues(), []);
  const [view, setView] = laUseState(null);
  laUseEffect(() => {
    if (!profile) return; let alive = true;
    SA.onevues.renderOnevue(profile, onevue).then(v => alive && setView(v));
    SA.analytics.track('demo_onevue', { onevue });
    return () => { alive = false; };
  }, [profile, onevue]);
  const meta = onevues && onevues.find(f => f.id === onevue);
  const items = (onevues || []).filter(f => DEMO_ONEVUES.includes(f.id)).map(f => ({ value: f.id, label: f.label }));
  const url = profile ? SA.shares.buildUrl(profile.username, onevue) : '';

  return (
    <section className="section" id="views" data-screen-label="Audience demo">
      <div className="wrap demo-grid">
        <div className="demo-side">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <Reveal><span className="eyebrow">Live demo</span></Reveal>
            <Reveal delay={.05}><h2 className="h-section">Same person.<br /><span className="italic">Different room.</span></h2></Reveal>
            <Reveal delay={.1}><p className="lede">This is Amara’s single profile. Switch the audience and watch it re-compose — sections appear, reorder, or disappear entirely.</p></Reveal>
          </div>
          {items.length > 0 && <Tabs items={items} value={onevue} onChange={setOnevue} label="Audience" idBase="demo" />}
          <AnimatePresence mode="wait">
            {meta && (
              <motion.div key={meta.id} className="demo-meta" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .3 }}>
                <p className="muted">{meta.blurb}</p>
                {view && view.hidden.length > 0 && (
                  <p className="demo-hidden faint"><Icon.lock /> Hidden from this view: {view.hidden.map(k => PV_TITLES[k].toLowerCase()).join(', ')}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Reveal delay={.1} className="demo-device-wrap">
          <GlassCard className="demo-device" id="demo-panel" role="tabpanel" aria-labelledby={'demo-tab-' + onevue}>
            <div className="device-bar">
              <span className="device-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="device-url mono">{url ? <><Icon.lock /> {url}</> : <Skeleton w={160} h={10} />}</span>
            </div>
            <div className="device-body">
              {view ? <OnevueView view={view} compact /> : (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><Skeleton w={56} h={56} r={56} /><div style={{ flex: 1, display: 'grid', gap: 8 }}><Skeleton w="50%" h={18} /><Skeleton w="70%" h={12} /></div></div>
                  <Skeleton h={80} /><Skeleton h={120} />
                </div>
              )}
            </div>
          </GlassCard>
        </Reveal>
      </div>
    </section>
  );
}

Object.assign(window, { Hero, Problem, HowItWorks, ProfileTypes, AudienceDemo });
