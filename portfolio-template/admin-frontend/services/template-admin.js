/* template-admin service — GitHub repository submission workflow (Phase 5.15). */
(function () {
  const { db } = window.OV.core;

  function base() {
    const configured = window.OV_ADMIN_API_BASE ||
      (window.OV_ENV && (window.OV_ENV.API_BASE || window.OV_ENV.API_URL)) ||
      'http://localhost:3000/api';
    return String(configured).replace(/\/+$/, '');
  }

  function bearer() {
    const session = db.get('session', null);
    return session && session.token ? { Authorization: 'Bearer ' + session.token } : {};
  }

  async function call(method, path, body) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...bearer() },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.message) || ('Request failed (' + res.status + ')'));
      err.code = data && data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.OV.services.templateAdmin = {
    /** Runs the full ingestion workflow for one GitHub repository URL. */
    submit: (payload) => call('POST', '/admin/templates/submit', payload),
    /** Recent submissions with their processing stages. */
    list: (limit = 25) => call('GET', '/admin/templates/submissions?limit=' + encodeURIComponent(limit)),
    /** One submission, including its current stages. */
    get: (ingestionId) => call('GET', '/admin/templates/submissions?ingestionId=' + encodeURIComponent(ingestionId)),
  };
})();
