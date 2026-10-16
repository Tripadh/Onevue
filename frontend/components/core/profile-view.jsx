/* Renders a onevue (output of services.onevues.renderOnevue). Pure presentation. */
const PV_TITLES = { summary: 'About', experience: 'Experience', education: 'Education', skills: 'Skills', portfolio: 'Selected work', services: 'Services', testimonials: 'Client words', activities: 'Activities', credentials: 'Verified credentials', contact: 'Contact', availability: 'Availability' };

function PVSection({ s }) {
  const d = s.data;
  switch (s.key) {
    case 'summary': return <p className="pv-summary">{d}</p>;
    case 'availability': return <Badge tone="primary" dot>{d}</Badge>;
    case 'skills': return <div className="pv-chips">{d.map(x => <span key={x} className="pv-chip">{x}</span>)}</div>;
    case 'experience': return <ul className="pv-list">{d.map(x => <li key={x.id}><div><strong>{x.role}</strong><span className="muted"> · {x.org}</span></div><span className="faint pv-period">{x.period}</span><p className="muted">{x.note}</p></li>)}</ul>;
    case 'education': return <ul className="pv-list">{d.map(x => <li key={x.id}><div><strong>{x.degree}</strong><span className="muted"> · {x.org}</span></div><span className="faint pv-period">{x.period}</span><p className="muted">{x.note}</p></li>)}</ul>;
    case 'activities': return <ul className="pv-list">{d.map(x => <li key={x.id}><div><strong>{x.title}</strong></div><p className="muted">{x.note}</p></li>)}</ul>;
    case 'portfolio': return <div className="pv-grid">{d.map(x => <div key={x.id} className="pv-work"><span className="pv-work-art" aria-hidden="true" /><strong>{x.title}</strong><span className="faint">{x.kind} · {x.metric}</span></div>)}</div>;
    case 'services': return <ul className="pv-list">{d.map(x => <li key={x.id} className="pv-svc"><strong>{x.name}</strong><span className="muted">{x.price} · {x.time}</span></li>)}</ul>;
    case 'testimonials': return <div>{d.map(x => <blockquote key={x.id} className="pv-quote"><p className="serif">“{x.quote}”</p><cite className="faint">{x.by}</cite></blockquote>)}</div>;
    case 'credentials': return <ul className="pv-creds">{d.map(c => <li key={c.id}><span><strong>{c.title}</strong><span className="faint">{c.issuer}</span></span><Verified /></li>)}</ul>;
    case 'contact': return <ul className="pv-contact">{Object.entries(d).filter(([, v]) => v).map(([k, v]) => <li key={k}><span className="faint">{k === 'web' ? 'Website' : k[0].toUpperCase() + k.slice(1)}</span><span className="mono">{v}</span></li>)}</ul>;
    default: return null;
  }
}

function OnevueView({ view, compact }) {
  if (!view) return null;
  const h = view.header;
  return (
    <div className={'pv' + (compact ? ' pv-compact' : '')}>
      <header className="pv-head">
        <Avatar initials={h.initials} size={compact ? 56 : 72} ring />
        <div className="pv-id">
          <h3 className="pv-name">{h.name} <span className="pv-tick" title="Identity verified"><Icon.seal /></span></h3>
          <p className="muted">{h.headline}</p>
          {h.location && <p className="faint" style={{ fontSize: 13.5 }}>{h.location}</p>}
        </div>
      </header>
      <div className="pv-sections">
        <AnimatePresence mode="popLayout" initial={false}>
          {view.sections.map((s, i) => (
            <motion.section key={view.onevue.id + s.key} className="pv-sec" layout
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: .45, delay: i * .05, ease: [.2, .8, .2, 1] }}>
              <h4 className="pv-sec-title">{PV_TITLES[s.key]}</h4>
              <PVSection s={s} />
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

Object.assign(window, { OnevueView, PV_TITLES });

