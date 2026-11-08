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
      err.submission = data && data.submission;
      throw err;
    }
    return data;
  }

  window.OV.services.templateAdmin = {
    /** Runs the full ingestion workflow for one GitHub repository URL. */
    submit: (payload) => call('POST', '/admin/templates/submit', payload),
    /** Human review decision (approve or reject) for an ingested template. */
    review: (payload) => call('POST', '/admin/templates/review', payload),
    /** Recent submissions with their processing stages. */
    list: (limit = 25) => call('GET', '/admin/templates/submissions?limit=' + encodeURIComponent(limit)),
    /** One submission, including its current stages. */
    get: (ingestionId) => call('GET', '/admin/templates/submissions?ingestionId=' + encodeURIComponent(ingestionId)),
    /** Public catalog for template preview and management. */
    catalog: () => call('GET', '/public/templates'),
    /**
     * The preview document a student would receive, fetched with the session
     * token. Returned as HTML text so the caller can place it in an iframe
     * through srcdoc; the artifact's asset URLs are already absolute and point
     * back at the delivery API, so they resolve from this origin.
     */
    previewHtml: async (templateId, templateVersion) => {
      const query = 'templateId=' + encodeURIComponent(templateId) +
        '&templateVersion=' + encodeURIComponent(templateVersion);
      const res = await fetch(base() + '/admin/templates/preview?' + query, {
        headers: bearer(),
        cache: 'no-store',
      });
      if (!res.ok) {
        let detail = null;
        try { detail = await res.json(); } catch (e) {}
        const err = new Error((detail && detail.message) || ('Preview failed (' + res.status + ')'));
        err.code = detail && detail.code;
        err.status = res.status;
        throw err;
      }
      return res.text();
    },
    /**
     * The retained source snapshot of a submission: its files and passive
     * metadata. This is a read-only inspection of what was ingested — no
     * template code is executed, unlike the artifact preview, which renders
     * the built release.
     */
    sourceSnapshot: async (ingestionId) => {
      const res = await fetch(base() + '/admin/templates/source?ingestionId=' + encodeURIComponent(ingestionId), {
        headers: bearer(),
        cache: 'no-store',
      });
      let detail = null;
      try { detail = await res.json(); } catch (e) {}
      if (!res.ok) {
        const err = new Error((detail && detail.message) || ('Source inspection failed (' + res.status + ')'));
        err.code = detail && detail.code;
        err.status = res.status;
        throw err;
      }
      return detail;
    },
    /** One file of a retained source snapshot, as text. */
    sourceFile: async (ingestionId, relativePath) => {
      const query = 'ingestionId=' + encodeURIComponent(ingestionId) +
        '&path=' + encodeURIComponent(relativePath);
      const res = await fetch(base() + '/admin/templates/source?' + query, {
        headers: bearer(),
        cache: 'no-store',
      });
      let detail = null;
      try { detail = await res.json(); } catch (e) {}
      if (!res.ok) {
        const err = new Error((detail && detail.message) || ('Source file unavailable (' + res.status + ')'));
        err.code = detail && detail.code;
        err.status = res.status;
        throw err;
      }
      return detail;
    },
  };
})();
