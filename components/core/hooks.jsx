/* App hooks — the only bridge between components and /services. */
const { useState: hkUseState, useEffect: hkUseEffect, useRef: hkUseRef } = React;
const S = window.OV.services;

/** Run an async service call and track {data, loading, error}. */
function useAsync(fn, deps = []) {
  const [state, setState] = hkUseState({ data: null, loading: true, error: null });
  hkUseEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      data => alive && setState({ data, loading: false, error: null }),
      error => alive && setState({ data: null, loading: false, error })
    );
    return () => { alive = false; };
  }, deps);
  return state;
}

function useTheme() {
  const [theme, setTheme] = hkUseState(window.OV.theme.get());
  hkUseEffect(() => window.OV.theme.subscribe(setTheme), []);
  return [theme, window.OV.theme.set];
}

function useSession() {
  const [session, setSession] = hkUseState(S.auth.getSessionSync());
  hkUseEffect(() => S.auth.onChange(setSession), []);
  return session;
}

function useDebounced(value, ms) {
  const [v, setV] = hkUseState(value);
  hkUseEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function useMediaQuery(q) {
  const [m, setM] = hkUseState(() => window.matchMedia(q).matches);
  hkUseEffect(() => { const mq = window.matchMedia(q); const f = e => setM(e.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

/** Smooth-scroll to a landing section (hash routing owns location.hash). */
function scrollToId(id) {
  const el = document.getElementById(id); if (!el) return false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 76, behavior: reduced ? 'auto' : 'smooth' });
  return true;
}

Object.assign(window, { useAsync, useTheme, useSession, useDebounced, useMediaQuery, scrollToId });
