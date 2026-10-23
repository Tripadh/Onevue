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

  function queryString(query) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const text = params.toString();
    return text ? '?' + text : '';
  }

  function authHeaders() {
    const session = db.get('session');
    const token = session && session.token;
    if (!token) {
      const error = new Error('Sign in to view analytics.');
      error.status = 401;
      throw error;
    }
    return { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  }

  async function analyticsGet(path, query) {
    const base = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
    const response = await fetch(base + path + queryString(query), { headers: authHeaders(), credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Analytics request failed.');
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  function getOverview(query) { return analyticsGet('/analytics/overview', query); }
  function getResources(query) { return analyticsGet('/analytics/resources', query); }
  function getResource(resourceId, query) { return analyticsGet('/analytics/resources/' + encodeURIComponent(resourceId), query); }
  function getTimeseries(resourceId, query) { return analyticsGet('/analytics/resources/' + encodeURIComponent(resourceId) + '/timeseries', query); }
  function getAudience(resourceId, query) { return analyticsGet('/analytics/resources/' + encodeURIComponent(resourceId) + '/audience', query); }
  function getSources(resourceId, query) { return analyticsGet('/analytics/resources/' + encodeURIComponent(resourceId) + '/sources', query); }
  function getEvents(resourceId, query) { return analyticsGet('/analytics/resources/' + encodeURIComponent(resourceId) + '/events', query); }

  async function exportReport(resourceId, query) {
    const base = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
    const response = await fetch(base + '/analytics/resources/' + encodeURIComponent(resourceId) + '/export' + queryString(Object.assign({ format: 'csv' }, query || {})), {
      headers: authHeaders(),
      credentials: 'omit',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.message || 'Export failed.');
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'onevue-analytics.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return blob;
  }

  window.OV.services.analytics = {
    track, getViewStats, getOverview, getResources, getResource, getTimeseries, getAudience, getSources, getEvents, exportReport,
  };
})();

