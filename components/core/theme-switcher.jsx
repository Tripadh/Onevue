/* Theme switcher: navbar pill + popover with live mini previews + floating dock.
   Each swatch/preview is a [data-theme] scope, so colors come straight from themes.css. */
const { useState: tsUseState, useEffect: tsUseEffect, useRef: tsUseRef } = React;

function Swatch({ id, size = 18, active }) {
  return <span data-theme={id} className={'swatch' + (active ? ' is-active' : '')} style={{ '--sz': size + 'px' }} aria-hidden="true" />;
}

/** A miniature, live-rendered Onevue card in a given palette. */
function MiniPreview({ id, large }) {
  return (
    <div data-theme={id} className={'mini' + (large ? ' mini-lg' : '')} aria-hidden="true">
      <div className="mini-bg" />
      <div className="mini-card">
        <div className="mini-row">
          <span className="mini-av">AO</span>
          <div className="mini-lines"><span className="mini-name" /><span className="mini-sub" /></div>
          <span className="mini-seal" />
        </div>
        <div className="mini-tags"><span className="on" /><span /><span /></div>
        {large && <div className="mini-body"><span /><span /><span className="short" /></div>}
        <span className="mini-cta" />
      </div>
    </div>
  );
}

function ThemePopover({ onClose, anchorRef }) {
  const [theme, setTheme] = useTheme();
  const ref = tsUseRef(null);
  tsUseEffect(() => {
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target) && !(anchorRef.current && anchorRef.current.contains(e.target))) onClose(); };
    const onKey = e => { if (e.key === 'Escape') { onClose(); anchorRef.current && anchorRef.current.focus(); } };
    document.addEventListener('pointerdown', onDoc); document.addEventListener('keydown', onKey);
    const first = ref.current && ref.current.querySelector('[aria-checked="true"]'); first && first.focus();
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const onKey = (e, i) => {
    const list = window.OV.theme.list; let n = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % list.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
    if (n !== null) { e.preventDefault(); setTheme(list[n].id); const b = ref.current.querySelectorAll('[role=radio]')[n]; b && b.focus(); }
  };
  return (
    <motion.div ref={ref} className="glass theme-pop" role="radiogroup" aria-label="Choose a theme"
      initial={{ opacity: 0, y: -8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: .98 }} transition={{ duration: .22, ease: [.2, .8, .2, 1] }}>
      <div className="theme-pop-head"><span className="eyebrow">Theme</span><span className="faint" style={{ fontSize: 12 }}>Saved on this device</span></div>
      <div className="theme-pop-list">
        {window.OV.theme.list.map((t, i) => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} tabIndex={theme === t.id ? 0 : -1}
            className={'theme-opt' + (theme === t.id ? ' is-on' : '')} onClick={() => setTheme(t.id)} onKeyDown={e => onKey(e, i)}>
            <MiniPreview id={t.id} />
            <span className="theme-opt-text"><strong>{t.name}</strong><span>{t.sub}</span></span>
            <span className="theme-opt-check">{theme === t.id && <Icon.check />}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function ThemePill() {
  const [open, setOpen] = tsUseState(false);
  const [theme] = useTheme();
  const btn = tsUseRef(null);
  const list = window.OV.theme.list;
  return (
    <div className="theme-pill-wrap">
      <button ref={btn} className="theme-pill" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}
        aria-label={'Theme: ' + window.OV.theme.meta(theme).name + '. Change theme'}>
        <span className="theme-dots">
          {list.map(t => <Swatch key={t.id} id={t.id} size={16} active={t.id === theme} />)}
        </span>
      </button>
      <AnimatePresence>{open && <ThemePopover onClose={() => setOpen(false)} anchorRef={btn} />}</AnimatePresence>
    </div>
  );
}

function ThemeDock() {
  const [theme, setTheme] = useTheme();
  const [show, setShow] = tsUseState(false);
  const [open, setOpen] = tsUseState(true);
  tsUseEffect(() => {
    const on = () => {
      const footer = document.getElementById('footer');
      const nearEnd = footer && footer.getBoundingClientRect().top < window.innerHeight - 40;
      setShow(window.scrollY > window.innerHeight * .6 && !nearEnd);
    };
    on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on);
  }, []);
  const meta = window.OV.theme.meta(theme);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="glass theme-dock" role="group" aria-label="Theme dock"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: .35, ease: [.2, .8, .2, 1] }}>
          <button className="dock-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Collapse theme dock' : 'Expand theme dock'}>
            <Swatch id={theme} size={22} active />
            <span className="dock-label"><span className="faint">Theme</span>{meta.name}</span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div className="dock-dots" initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: .3 }}>
                {window.OV.theme.list.map(t => (
                  <button key={t.id} className={'dock-dot' + (t.id === theme ? ' is-on' : '')} onClick={() => setTheme(t.id)} aria-pressed={t.id === theme} aria-label={t.name} title={t.name}>
                    <Swatch id={t.id} size={20} active={t.id === theme} />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

Object.assign(window, { Swatch, MiniPreview, ThemePill, ThemeDock });
