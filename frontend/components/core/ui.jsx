/* Shared UI kit. No storage, no fetch, no hardcoded colors. */
const { useState: uiUseState, useEffect: uiUseEffect, useRef: uiUseRef, useCallback: uiUseCallback, createContext: uiCreateContext, useContext: uiUseContext, useId: uiUseId } = React;

// Framer Motion (UMD) with graceful fallback
const FM = window.Motion || {};
const motion = FM.motion || new Proxy({}, { get: (_, tag) => React.forwardRef(({ initial, animate, exit, transition, whileHover, whileTap, whileInView, viewport, layout, layoutId, variants, ...rest }, ref) => React.createElement(tag, { ref, ...rest })) });
const AnimatePresence = FM.AnimatePresence || (({ children }) => <>{children}</>);

function usePrefersReducedMotion() {
  const [r, setR] = uiUseState(() => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  uiUseEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = e => setR(e.matches); mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn);
  }, []);
  return r;
}

/* ---------- Icons (simple strokes only) ---------- */
const Icon = {
  check: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  x: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  arrow: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  plus: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14" /></svg>,
  menu: (p) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...p}><path d="M4 8h16M4 16h16" /></svg>,
  copy: (p) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" {...p}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></svg>,
  seal: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...p}><path d="M12 2.5l2.6 1.9 3.2-.2.9 3.1 2.6 1.9-1.1 3 1.1 3-2.6 1.9-.9 3.1-3.2-.2L12 21.5l-2.6-1.9-3.2.2-.9-3.1-2.6-1.9 1.1-3-1.1-3 2.6-1.9.9-3.1 3.2.2z" /><path d="M8.5 12.2l2.4 2.3 4.6-4.8" strokeLinecap="round" /></svg>,
  lock: (p) => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>,
};

/* ---------- Button ---------- */
function Button({ variant = 'primary', size, block, loading, children, className = '', icon, ...rest }) {
  const cls = ['btn', 'btn-' + variant, size && 'btn-' + size, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spin" aria-hidden="true" /> : null}
      {children}
      {icon && !loading ? icon : null}
    </button>
  );
}

/* ---------- Input ---------- */
function Input({ label, hint, error, id, className = '', ...rest }) {
  const auto = uiUseId(); const fid = id || auto;
  return (
    <div className={'field ' + className}>
      {label && <label className="field-label" htmlFor={fid}>{label}</label>}
      <input id={fid} className="input" aria-invalid={!!error || undefined} aria-describedby={error || hint ? fid + '-d' : undefined} {...rest} />
      {error ? <span id={fid + '-d'} className="field-error" role="alert">{error}</span> : hint ? <span id={fid + '-d'} className="field-hint">{hint}</span> : null}
    </div>
  );
}

/* ---------- Select ---------- */
function Select({ label, options, hint, id, ...rest }) {
  const auto = uiUseId(); const fid = id || auto;
  return (
    <div className="field">
      {label && <label className="field-label" htmlFor={fid}>{label}</label>}
      <div className="select-wrap">
        <select id={fid} className="select" {...rest}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/* ---------- Toggle ---------- */
function Toggle({ checked, onChange, label, ...rest }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} aria-checked={checked} {...rest} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ---------- GlassCard (optional 3D tilt) ---------- */
function GlassCard({ tilt = false, max = 7, className = '', style, children, as = 'div', ...rest }) {
  const ref = uiUseRef(null);
  const reduced = usePrefersReducedMotion();
  const enable = tilt && !reduced;
  const onMove = uiUseCallback((e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-4px)`;
    el.style.setProperty('--mx', ((x + .5) * 100).toFixed(1) + '%'); el.style.setProperty('--my', ((y + .5) * 100).toFixed(1) + '%');
  }, [max]);
  const onLeave = uiUseCallback(() => { const el = ref.current; if (el) el.style.transform = ''; }, []);
  const Tag = as;
  return (
    <Tag ref={ref} className={'glass ' + (enable ? 'tilt ' : '') + className} style={style}
      onPointerMove={enable ? onMove : undefined} onPointerLeave={enable ? onLeave : undefined} {...rest}>
      {children}
    </Tag>
  );
}

/* ---------- Tabs ---------- */
function Tabs({ items, value, onChange, label, idBase = 'tabs' }) {
  const refs = uiUseRef([]);
  const onKey = (e, i) => {
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    if (n !== null) { e.preventDefault(); onChange(items[n].value); refs.current[n] && refs.current[n].focus(); }
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it, i) => {
        const sel = it.value === value;
        return (
          <button key={it.value} ref={el => refs.current[i] = el} role="tab" id={idBase + '-tab-' + it.value} aria-controls={idBase + '-panel'}
            aria-selected={sel} tabIndex={sel ? 0 : -1} className="tab" onClick={() => onChange(it.value)} onKeyDown={e => onKey(e, i)}>
            {sel && <motion.span layoutId={idBase + '-ink'} className="tab-ink" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Focus trap helper ---------- */
function useDialog(open, onClose, ref) {
  uiUseEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const ov = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const t = setTimeout(() => { const el = ref.current && ref.current.querySelector('[data-autofocus], input, button:not(.modal-close)'); el && el.focus(); }, 60);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ov; clearTimeout(t); prev && prev.focus && prev.focus(); };
  }, [open]);
}

/* ---------- Modal ---------- */
function Modal({ open, onClose, title, children, labelledBy }) {
  const ref = uiUseRef(null);
  useDialog(open, onClose, ref);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .25 }} />
          <div className="modal-host" key="host">
            <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : title}
              className="glass modal" initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
              <button className="icon-btn modal-close" onClick={onClose} aria-label="Close"><Icon.x /></button>
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------- Drawer ---------- */
function Drawer({ open, onClose, title, children }) {
  const ref = uiUseRef(null);
  useDialog(open, onClose, ref);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside key="drawer" ref={ref} role="dialog" aria-modal="true" aria-label={title} className="glass drawer"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
            <button className="icon-btn modal-close" onClick={onClose} aria-label="Close"><Icon.x /></button>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------- Toast ---------- */
const ToastCtx = uiCreateContext({ push: () => {} });
function ToastProvider({ children }) {
  const [items, setItems] = uiUseState([]);
  const push = uiUseCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setItems(s => [...s.slice(-2), { id, tone: 'info', ...t }]);
    setTimeout(() => setItems(s => s.filter(x => x.id !== id)), t.duration || 3800);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map(t => (
            <motion.div key={t.id} layout className={'glass toast ' + t.tone} initial={{ opacity: 0, y: 16, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}>
              <span className="toast-dot" />
              <div><strong>{t.title}</strong>{t.body && <span>{t.body}</span>}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => uiUseContext(ToastCtx);

/* ---------- Badge / Avatar / Skeleton / EmptyState ---------- */
function Badge({ tone, dot, children, icon }) {
  return <span className={'badge' + (tone ? ' badge-' + tone : '') + (dot ? ' badge-dot' : '')}>{icon}{children}</span>;
}
function Verified({ children = 'Verified' }) { return <Badge tone="verified" icon={<Icon.seal />}>{children}</Badge>; }
function Avatar({ initials, size = 44, ring }) {
  return <span className={'avatar' + (ring ? ' ring' : '')} style={{ '--s': size + 'px' }} aria-hidden="true">{initials}</span>;
}
function Skeleton({ w = '100%', h = 14, r, style }) {
  return <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}
function EmptyState({ title, body, action }) {
  return (
    <div className="empty">
      <div className="empty-mark"><Icon.plus /></div>
      <h4>{title}</h4>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

/* ---------- Reveal on scroll ---------- */
function Reveal({ children, delay = 0, y = 22, className, as = 'div', style }) {
  const reduced = usePrefersReducedMotion();
  const M = motion[as] || motion.div;
  return (
    <M className={className} style={style} initial={reduced ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -60px 0px' }} transition={{ duration: .8, delay, ease: [.2, .8, .2, 1] }}>
      {children}
    </M>
  );
}

/* ---------- Clipboard helper (UI-level, not data) ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok;
  }
}

Object.assign(window, { motion, AnimatePresence, usePrefersReducedMotion, Icon, Button, Input, Select, Toggle, GlassCard, Tabs, Modal, Drawer, ToastProvider, useToast, Badge, Verified, Avatar, Skeleton, EmptyState, Reveal, copyText });
