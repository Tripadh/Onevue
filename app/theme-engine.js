/* Theme engine: applies palette before first paint, persists via site service,
   notifies subscribers. Palette values live in styles/themes.css only. */
(function () {
  const THEMES = [
    { id: 'sapphire', name: 'Midnight Sapphire', sub: '& Platinum', mode: 'dark' },
    { id: 'obsidian', name: 'Obsidian', sub: '& Champagne Gold', mode: 'dark' },
    { id: 'emerald', name: 'Emerald Royale', sub: 'Deep green & brass', mode: 'dark' },
    { id: 'plum', name: 'Imperial Plum', sub: '& Rose Gold', mode: 'dark' },
    { id: 'ivory', name: 'Ivory Light Luxe', sub: 'Frosted white glass', mode: 'light' },
  ];
  const site = window.OV.services.site;
  const subs = new Set();
  let current = site.getThemePreference();
  if (!THEMES.some(t => t.id === current)) current = 'sapphire';

  function apply(id) {
    const root = document.documentElement;
    root.setAttribute('data-theme', id);
    root.style.colorScheme = THEMES.find(t => t.id === id).mode;
  }
  apply(current);

  /** Reads live (possibly mid-transition) token values — used by the WebGL gem. */
  function readTokens(names) {
    const cs = getComputedStyle(document.documentElement);
    const out = {}; names.forEach(n => { out[n] = cs.getPropertyValue('--' + n).trim(); }); return out;
  }

  window.OV.theme = {
    list: THEMES,
    get: () => current,
    meta: id => THEMES.find(t => t.id === (id || current)),
    set(id) {
      if (!THEMES.some(t => t.id === id) || id === current) return;
      current = id; apply(id); site.setThemePreference(id);
      window.OV.services.analytics.track('theme_change', { theme: id });
      subs.forEach(fn => fn(id));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    readTokens,
  };
})();
