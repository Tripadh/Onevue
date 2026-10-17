/* analytics service — product events + profile view stats. */
(function () {
  const { db, http, isLive, uid } = window.OV.core;

  /** Fire-and-forget event. Never throws. */
  function track(name, props) {
    try {
      if (isLive()) { http('POST', '/events', { name, props }).catch(() => {}); return; }
      const all = db.list('c:events'); all.push({ id: uid('ev'), name, props: props || {}, at: Date.now() });
      db.set('c:events', all.slice(-500));
    } catch (e) {}
  }

  async function getViewStats(username) {
    if (isLive()) return http('GET', '/analytics/' + username);
    const views = db.filter('c:events', e => e.name === 'profile_view' && e.props.username === username);
    const byOnevue = {}; views.forEach(v => { byOnevue[v.props.onevue] = (byOnevue[v.props.onevue] || 0) + 1; });
    return { total: views.length, byOnevue };
  }

  window.OV.services.analytics = { track, getViewStats };
})();
