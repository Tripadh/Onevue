/* Landing — part B: themes, credentials, QR, testimonials, pricing, FAQ, closing CTA, footer. */
const { useState: lbUseState, useEffect: lbUseEffect, useRef: lbUseRef } = React;
const SB = window.OV.services;

function ThemeGallery() {
  const [theme, setTheme] = useTheme();
  return (
    <section className="section" id="themes" data-screen-label="Themes">
      <div className="wrap">
        <div className="section-head center">
          <Reveal><span className="eyebrow">Make it yours</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Five palettes. <span className="italic">All quiet.</span></h2></Reveal>
          <Reveal delay={.1}><p className="lede">Choose the room your profile lives in. Try one — this whole page changes with it, and so will your public link.</p></Reveal>
        </div>
        <div className="gallery" role="radiogroup" aria-label="Theme gallery">
          {window.OV.theme.list.map((t, i) => (
            <Reveal key={t.id} delay={i * .06} className="gallery-item">
              <button role="radio" aria-checked={theme === t.id} className={'gallery-card' + (theme === t.id ? ' is-on' : '')} onClick={() => setTheme(t.id)}>
                <MiniPreview id={t.id} large />
                <span className="gallery-text">
                  <span><strong className="serif">{t.name}</strong><span className="faint">{t.sub}</span></span>
                  <span className="gallery-sw">{['primary', 'soft', 'accent'].map(k => <i key={k} data-theme={t.id} style={{ background: `var(--${k})` }} />)}</span>
                </span>
                {theme === t.id && <span className="gallery-on"><Icon.check /> Active</span>}
              </button>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CredentialsShowcase() {
  const { data: creds } = useAsync(() => SB.profile.getDemoProfile().then(p => SB.credentials.listCredentials(p.id)), []);
  const [sel, setSel] = lbUseState(null);
  const [res, setRes] = lbUseState(null);
  const [busy, setBusy] = lbUseState(false);
  async function check(c) {
    setSel(c.id); setRes(null); setBusy(true);
    try { setRes(await SB.credentials.verify(c.id)); SB.analytics.track('credential_check', { kind: c.kind }); }
    finally { setBusy(false); }
  }
  lbUseEffect(() => { if (creds && creds.length && !sel) check(creds[0]); }, [creds]);

  return (
    <section className="section" id="verified" data-screen-label="Verified credentials">
      <div className="wrap cred-grid">
        <div>
          <div className="section-head">
            <Reveal><span className="eyebrow">Verified credentials</span></Reveal>
            <Reveal delay={.05}><h2 className="h-section">Claims are cheap.<br /><span className="italic">Proof is quiet.</span></h2></Reveal>
            <Reveal delay={.1}><p className="lede">Degrees, employers, certifications and identity are confirmed with the issuer — then sealed. Anyone viewing your link can re-check the trail in one tap.</p></Reveal>
          </div>
          <ul className="cred-list">
            {(creds || []).map((c, i) => (
              <Reveal as="li" key={c.id} delay={i * .06}>
                <button className={'cred-row glass lift' + (sel === c.id ? ' is-on' : '')} onClick={() => check(c)} aria-pressed={sel === c.id}>
                  <span className="cred-kind faint">{c.kind}</span>
                  <span className="cred-title"><strong>{c.title}</strong><span className="muted">{c.issuer}</span></span>
                  <Verified />
                </button>
              </Reveal>
            ))}
            {!creds && [0, 1, 2, 3].map(i => <li key={i}><Skeleton h={68} r={18} /></li>)}
          </ul>
        </div>
        <Reveal delay={.15} className="cred-proof-wrap">
          <GlassCard tilt max={5} className="cred-proof">
            <div className="cred-seal-big" aria-hidden="true"><Icon.seal width="34" height="34" /></div>
            <span className="eyebrow">Verification trail</span>
            <AnimatePresence mode="wait">
              {busy || !res ? (
                <motion.div key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="trail">
                  <p className="muted" style={{ marginBottom: 16 }}>Contacting issuer…</p>
                  {[0, 1, 2, 3].map(i => <Skeleton key={i} h={44} r={12} style={{ marginBottom: 10 }} />)}
                </motion.div>
              ) : (
                <motion.div key={res.credential.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="trail">
                  <h3 className="h-card" style={{ marginBottom: 6 }}>{res.credential.title}</h3>
                  <p className="faint" style={{ fontSize: 13.5, marginBottom: 18 }}>via {res.credential.method}</p>
                  <ol className="trail-list">
                    {res.trail.map((t, i) => (
                      <motion.li key={t.step} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .12 + i * .14 }}>
                        <span className="trail-tick"><Icon.check /></span>
                        <span><strong>{t.step}</strong><span className="faint mono">{t.detail}</span></span>
                      </motion.li>
                    ))}
                  </ol>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        </Reveal>
      </div>
    </section>
  );
}

function QRCode({ url }) {
  const { data: m } = useAsync(() => SB.shares.qrMatrix(url, 25), [url]);
  if (!m) return <Skeleton w="100%" h={220} r={16} />;
  const n = m.length;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="qr-svg" role="img" aria-label={'QR code for ' + url}>
      <rect x="-2" y="-2" width={n + 4} height={n + 4} rx="2.4" className="qr-bg" />
      {m.map((row, r) => row.map((on, c) => on ? <rect key={r + '-' + c} x={c + .06} y={r + .06} width=".88" height=".88" rx=".22" className="qr-mod" /> : null))}
      <rect x={n / 2 - 2.6} y={n / 2 - 2.6} width="5.2" height="5.2" rx="1.2" className="qr-bg" />
      <rect x={n / 2 - 1.5} y={n / 2 - 1.5} width="3" height="3" rx=".3" className="qr-center" transform={`rotate(45 ${n / 2} ${n / 2})`} />
    </svg>
  );
}

function QRShare() {
  const toast = useToast();
  const { data: onevues } = useAsync(() => SB.onevues.listOnevues(), []);
  const [onevue, setOnevue] = lbUseState('recruiter');
  const [expiring, setExpiring] = lbUseState(false);
  const [days, setDays] = lbUseState('7');
  const [share, setShare] = lbUseState(null);
  const [busy, setBusy] = lbUseState(false);
  const url = share ? share.url : SB.shares.buildUrl('amara', onevue === 'all' ? null : onevue);
  lbUseEffect(() => setShare(null), [onevue, expiring, days]);

  async function create() {
    setBusy(true);
    try {
      const s = await SB.shares.createShare({ username: 'amara', onevueId: onevue === 'all' ? undefined : onevue, expiresInDays: expiring ? Number(days) : undefined });
      setShare(s); SB.analytics.track('share_created', { onevue });
      toast.push({ title: 'Audience link created', body: s.url, tone: 'success' });
    } finally { setBusy(false); }
  }
  async function copy() {
    const ok = await copyText('https://' + url);
    toast.push(ok ? { title: 'Copied to clipboard', body: url, tone: 'success' } : { title: 'Couldn’t copy', body: 'Select the link and copy it manually.' });
  }
  const opts = [{ value: 'all', label: 'Full profile (default view)' }, ...((onevues || []).map(f => ({ value: f.id, label: f.label + ' view' })))];

  return (
    <section className="section" id="share" data-screen-label="QR sharing">
      <div className="wrap qr-grid">
        <Reveal className="qr-card-wrap">
          <GlassCard tilt max={6} className="qr-card">
            <div className="qr-card-head">
              <Avatar initials="AO" size={40} />
              <div><strong>Amara Okafor</strong><span className="faint" style={{ display: 'block', fontSize: 13 }}>{onevue === 'all' ? 'Full profile' : (opts.find(o => o.value === onevue) || {}).label}</span></div>
            </div>
            <div className="qr-frame"><QRCode url={url} /></div>
            <div className="qr-url mono">{url}</div>
            {share && share.expiresAt && <p className="faint" style={{ fontSize: 12.5, textAlign: 'center' }}>Expires {new Date(share.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
          </GlassCard>
        </Reveal>
        <div>
          <div className="section-head">
            <Reveal><span className="eyebrow">Share anywhere</span></Reveal>
            <Reveal delay={.05}><h2 className="h-section">A link for every <span className="italic">handshake.</span></h2></Reveal>
            <Reveal delay={.1}><p className="lede">Print the QR on your card, drop the recruiter link in an application, send a client link that quietly expires after the pitch.</p></Reveal>
          </div>
          <Reveal delay={.15}>
            <GlassCard className="qr-controls">
              <Select label="Who is this for?" value={onevue} onChange={e => setOnevue(e.target.value)} options={opts} />
              <div className="qr-row">
                <Toggle checked={expiring} onChange={setExpiring} label="Link expires" />
                {expiring && <div style={{ width: 150 }}><Select aria-label="Expiry" value={days} onChange={e => setDays(e.target.value)} options={[{ value: '1', label: 'In 24 hours' }, { value: '7', label: 'In 7 days' }, { value: '30', label: 'In 30 days' }]} /></div>}
              </div>
              <div className="qr-actions">
                <Button loading={busy} onClick={create}>{share ? 'Create another' : 'Create audience link'}</Button>
                <Button variant="glass" icon={<Icon.copy />} onClick={copy}>Copy</Button>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const { data } = useAsync(() => SB.site.listTestimonials(), []);
  return (
    <section className="section" id="stories" data-screen-label="Testimonials">
      <div className="wrap">
        <div className="section-head center">
          <Reveal><span className="eyebrow">In their words</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Fewer links. <span className="italic">Better rooms.</span></h2></Reveal>
        </div>
        <div className="quotes">
          {(data || [0, 1, 2]).map((q, i) => (
            <Reveal key={q.id || i} delay={i * .08} className="quote-wrap">
              <GlassCard tilt max={5} className="quote">
                {q.id ? (
                  <>
                    <p className="quote-text serif">“{q.quote}”</p>
                    <div className="quote-by"><Avatar initials={q.initials} size={40} /><span><strong>{q.name}</strong><span className="faint">{q.role}</span></span></div>
                  </>
                ) : (<><Skeleton h={14} /><Skeleton h={14} style={{ marginTop: 10 }} /><Skeleton w="60%" h={14} style={{ marginTop: 10 }} /></>)}
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const { openAuth } = useApp();
  const toast = useToast();
  const { data: plans } = useAsync(() => SB.site.listPlans(), []);
  const [yearly, setYearly] = lbUseState(true);
  const price = p => p.price === 0 ? 0 : yearly ? Math.round(p.price * .8) : p.price;
  const choose = (p) => {
    SB.analytics.track('plan_click', { plan: p.id, yearly });
    if (p.id === 'free') openAuth('signup');
    else { openAuth('signup'); toast.push({ title: p.name + ' selected', body: 'Create your account — your 14-day trial starts after you claim a username.' }); }
  };
  return (
    <section className="section" id="pricing" data-screen-label="Pricing">
      <div className="wrap">
        <div className="section-head center">
          <Reveal><span className="eyebrow">Pricing</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Free to claim. <span className="italic">Fair to keep.</span></h2></Reveal>
          <Reveal delay={.1}><Toggle checked={yearly} onChange={setYearly} label={yearly ? 'Billed yearly · save 20%' : 'Billed monthly'} /></Reveal>
        </div>
        <div className="plans">
          {(plans || []).map((p, i) => (
            <Reveal key={p.id} delay={i * .08} className="plan-wrap">
              <GlassCard className={'plan lift' + (p.featured ? ' is-featured' : '')}>
                {p.featured && <span className="plan-flag">Most chosen</span>}
                <h3 className="h-card">{p.name}</h3>
                <p className="muted plan-line">{p.line}</p>
                <div className="plan-price"><span className="serif">€{price(p)}</span><span className="faint">{p.price === 0 ? p.period : 'per month' + (yearly ? ', billed yearly' : '')}</span></div>
                <ul className="plan-feats">{p.features.map(f => <li key={f}><Icon.check />{f}</li>)}</ul>
                <Button block variant={p.featured ? 'accent' : 'glass'} onClick={() => choose(p)}>{p.price === 0 ? 'Claim for free' : 'Start 14-day trial'}</Button>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const { data } = useAsync(() => SB.site.listFaq(), []);
  const [open, setOpen] = lbUseState(0);
  return (
    <section className="section" id="faq" data-screen-label="FAQ">
      <div className="wrap faq-grid">
        <div className="section-head">
          <Reveal><span className="eyebrow">Questions</span></Reveal>
          <Reveal delay={.05}><h2 className="h-section">Asked, <span className="italic">answered.</span></h2></Reveal>
        </div>
        <div className="faq">
          {(data || []).map((f, i) => {
            const on = open === i;
            return (
              <div key={f.q} className={'faq-item' + (on ? ' is-on' : '')}>
                <h3><button className="faq-q" aria-expanded={on} aria-controls={'faq-a' + i} id={'faq-q' + i} onClick={() => setOpen(on ? -1 : i)}>
                  <span>{f.q}</span><span className="faq-ico" aria-hidden="true" />
                </button></h3>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div id={'faq-a' + i} role="region" aria-labelledby={'faq-q' + i} className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .35, ease: [.2, .8, .2, 1] }}>
                      <p className="muted">{f.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="section closing" data-screen-label="Closing CTA">
      <div className="wrap">
        <GlassCard className="closing-card">
          <span className="eyebrow">Your name is waiting</span>
          <h2 className="h-section">Claim <span className="italic metal-text">onevue.id/you</span><br />before someone else does.</h2>
          <UrlClaimer compact idSuffix="-2" />
        </GlassCard>
      </div>
    </section>
  );
}

function Footer() {
  const toast = useToast();
  const [email, setEmail] = lbUseState('');
  const [err, setErr] = lbUseState('');
  const [busy, setBusy] = lbUseState(false);
  async function sub(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await SB.notifications.subscribe(email); setEmail(''); toast.push({ title: r.already ? 'You’re already on the list' : 'Subscribed', body: 'Product notes, roughly once a month.', tone: 'success' }); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  const cols = [
    { h: 'Product', l: [['How it works', 'how'], ['Audience views', 'views'], ['Themes', 'themes'], ['Pricing', 'pricing']] },
    { h: 'Trust', l: [['Verified credentials', 'verified'], ['QR & links', 'share'], ['FAQ', 'faq']] },
    { h: 'For', l: [['Students', 'types'], ['Professionals', 'types'], ['Freelancers & creators', 'types'], ['Businesses', 'types']] },
  ];
  const loc = ReactRouterDOM.useLocation();
  if (loc && loc.pathname && loc.pathname.startsWith('/app/student')) {
    return null;
  }

  return (
    <footer className="footer" id="footer">
      <div className="wrap">
        <hr className="rule" />
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p className="muted" style={{ maxWidth: '32ch' }}>One identity. Every view. A single verified profile, shared exactly as each audience needs it.</p>
            <form onSubmit={sub} className="footer-form" noValidate>
              <Input aria-label="Email for product notes" type="email" placeholder="Email for product notes" value={email} onChange={e => setEmail(e.target.value)} error={err} />
              <Button type="submit" variant="glass" loading={busy}>Subscribe</Button>
            </form>
          </div>
          {cols.map(c => (
            <div key={c.h} className="footer-col">
              <span className="eyebrow">{c.h}</span>
              <ul>{c.l.map(([t, id]) => <li key={t}><button onClick={() => scrollToId(id)}>{t}</button></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="footer-base faint">
          <span>© {new Date().getFullYear()} Onevue</span>
          <span><ReactRouterDOM.Link to="/amara" className="footer-link">See a live profile: onevue.id/amara</ReactRouterDOM.Link></span>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { ThemeGallery, CredentialsShowcase, QRShare, Testimonials, Pricing, FAQ, ClosingCTA, Footer });
