/* First-party analytics collector for published visiting cards. */
(function (root) {
  const VERSION = '1';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const MIN_ENGAGEMENT_MS = 1000;

  function randomId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'ev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function readCampaign() {
    const stored = root.sessionStorage && root.sessionStorage.getItem('ov_analytics_campaign');
    if (stored) {
      try { return JSON.parse(stored); } catch (error) { /* ignore corrupt campaign */ }
    }
    const search = (root.location && root.location.search) || '';
    const hash = (root.location && root.location.hash) || '';
    const hashQuery = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?')) : '';
    const params = new URLSearchParams(search || hashQuery);
    const campaign = {
      source: params.get('utm_source'),
      medium: params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
      content: params.get('utm_content'),
      term: params.get('utm_term'),
    };
    if (Object.values(campaign).some(Boolean) && root.sessionStorage) {
      root.sessionStorage.setItem('ov_analytics_campaign', JSON.stringify(campaign));
    }
    return campaign;
  }

  function visitorId(consent) {
    if (!consent || !root.localStorage) return null;
    let value = root.localStorage.getItem('ov_analytics_visitor');
    if (!value || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
      value = randomId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36);
      root.localStorage.setItem('ov_analytics_visitor', value);
    }
    return value;
  }

  function sessionId(consent) {
    if (!consent || !root.sessionStorage) return null;
    const now = Date.now();
    let stored = null;
    try { stored = JSON.parse(root.sessionStorage.getItem('ov_analytics_session') || 'null'); } catch (error) { stored = null; }
    if (!stored || !stored.id || now - Number(stored.last || 0) > SESSION_TIMEOUT_MS) {
      stored = { id: randomId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36), last: now };
    } else {
      stored.last = now;
    }
    root.sessionStorage.setItem('ov_analytics_session', JSON.stringify(stored));
    return stored.id;
  }

  function buildEvent(options, eventType, extra) {
    const consent = options.consent !== false && root.OV_ANALYTICS_CONSENT !== false;
    return {
      sdkVersion: VERSION,
      eventId: randomId(),
      resourceId: options.resourceId,
      resourceType: options.resourceType,
      eventType: eventType,
      path: options.path || (root.location ? root.location.pathname : '/'),
      referrer: root.document ? root.document.referrer : '',
      utm: readCampaign(),
      visitorId: consent ? visitorId(true) : null,
      sessionId: consent ? sessionId(true) : null,
      consent: consent,
      metadata: extra && extra.metadata ? extra.metadata : {},
      engagementMs: extra && extra.engagementMs,
    };
  }

  function send(endpoint, payload) {
    const body = JSON.stringify(payload);
    if (root.navigator && root.navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'text/plain' });
      if (root.navigator.sendBeacon(endpoint, blob)) return;
    }
    if (root.fetch) {
      root.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    }
  }

  const seen = {};

  function createTracker(options) {
    const started = Date.now();
    let flushed = false;
    function track(eventType, extra) {
      try { send(options.endpoint, buildEvent(options, eventType, extra)); } catch (error) { /* analytics must not break the page */ }
    }
    function pageView() {
      const key = options.resourceId + '|' + (options.path || '/');
      if (seen[key]) return;
      seen[key] = true;
      track('page_view');
    }
    function flushEngagement() {
      if (flushed) return;
      const elapsed = Date.now() - started;
      if (elapsed < MIN_ENGAGEMENT_MS) return;
      flushed = true;
      track('engagement_time', { engagementMs: Math.min(elapsed, SESSION_TIMEOUT_MS) });
    }
    function onClick(event) {
      const target = event.target && event.target.closest ? event.target.closest('[data-ov-track], a[href]') : null;
      if (!target) return;
      const trackName = target.getAttribute && target.getAttribute('data-ov-track');
      const action = (target.getAttribute && target.getAttribute('data-ov-action')) || '';
      const href = target.getAttribute && target.getAttribute('href');
      if (trackName === 'download' || action === 'resume' || action === 'vcard' || action === 'png' || action === 'pdf' || (href && /\.pdf($|\?)/i.test(href))) {
        track('download', { metadata: { action: action || 'download' } });
        return;
      }
      if (trackName === 'engagement') {
        track('engagement', { metadata: { action: action || 'engagement', side: target.getAttribute('data-ov-side') || '' } });
        return;
      }
      if (href && (href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('http') === 0)) {
        track('link_click', { metadata: { action: action || 'link' } });
      }
    }
    function observe(target) {
      pageView();
      const node = target || root.document;
      if (node && node.addEventListener) node.addEventListener('click', onClick);
      return function () {
        if (node && node.removeEventListener) node.removeEventListener('click', onClick);
        flushEngagement();
      };
    }
    return { track: track, pageView: pageView, flushEngagement: flushEngagement, observe: observe };
  }

  const api = { version: VERSION, sessionTimeoutMs: SESSION_TIMEOUT_MS, buildEvent: buildEvent, createTracker: createTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OneVueAnalytics = api;
})(typeof window !== 'undefined' ? window : globalThis);
