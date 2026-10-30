/**
 * OneVue Unified Typed API Client
 * Single source of truth for frontend-backend communication.
 * Handles base URL configuration, auth injection, timeouts, exponential retries, and normalized errors.
 */
(function () {
  'use strict';

  class ApiClientError extends Error {
    constructor(code, message, status = 0, details = null) {
      super(message);
      this.name = 'ApiClientError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }

  function getBaseUrl() {
    const configured = window.OV_ENV && (window.OV_ENV.API_BASE || window.OV_ENV.API_URL);
    return String(configured || 'http://localhost:3000/api').replace(/\/+$/, '');
  }

  function getAuthToken() {
    try {
      const db = window.OV?.core?.db;
      if (db) {
        const session = db.get('session', null);
        return session?.token || null;
      }
      const raw = localStorage.getItem('onevue:session');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.token || null;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Internal request orchestrator with timeout and exponential retry.
   */
  async function rawRequest(endpoint, options = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      timeoutMs = 15000,
      retries = method === 'GET' ? 2 : 0,
      retryDelayMs = 600,
      isFormData = false,
    } = options;

    const baseUrl = getBaseUrl();
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const token = getAuthToken();

    const requestHeaders = new Headers(headers);
    if (!isFormData && !requestHeaders.has('Content-Type') && body !== undefined) {
      requestHeaders.set('Content-Type', 'application/json');
    }
    if (token && !requestHeaders.has('Authorization')) {
      requestHeaders.set('Authorization', `Bearer ${token}`);
    }

    let attempt = 0;
    while (true) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: isFormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        let data = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            data = await response.json();
          } catch (_) {
            data = null;
          }
        } else if (response.status !== 204) {
          try {
            data = await response.text();
          } catch (_) {
            data = null;
          }
        }

        if (!response.ok) {
          const msg = (data && typeof data === 'object' && data.message) || `Request failed with status ${response.status}`;
          const isRetryableStatus = [502, 503, 504].includes(response.status);

          if (isRetryableStatus && attempt <= retries) {
            await new Promise(res => setTimeout(res, retryDelayMs * Math.pow(2, attempt - 1)));
            continue;
          }

          throw new ApiClientError(
            `http_${response.status}`,
            msg,
            response.status,
            data
          );
        }

        return data;
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof ApiClientError) {
          throw err;
        }

        const isAbort = err.name === 'AbortError';
        const isNetwork = !isAbort && (err.name === 'TypeError' || err.message?.includes('fetch'));

        if ((isAbort || isNetwork) && attempt <= retries) {
          await new Promise(res => setTimeout(res, retryDelayMs * Math.pow(2, attempt - 1)));
          continue;
        }

        if (isAbort) {
          throw new ApiClientError('timeout', `Request timed out after ${timeoutMs}ms.`, 408);
        }
        throw new ApiClientError('network_error', 'Could not connect to server. Please check your network connection.', 0, err);
      }
    }
  }

  // Domain API Modules
  const api = {
    // Core plumbing
    request: rawRequest,
    getBaseUrl,
    ApiClientError,

    // 1. Health
    health: {
      check: () => rawRequest('/health'),
    },

    // 2. Auth
    auth: {
      register: (payload) => rawRequest('/auth/register', { method: 'POST', body: payload }),
      login: (email, password) => rawRequest('/auth/login', { method: 'POST', body: { email, password } }),
      me: () => rawRequest('/auth/me'),
      setIdentity: (identity) => rawRequest('/auth/set-identity', { method: 'POST', body: { identity } }),
      submitSurvey: (surveyData) => rawRequest('/auth/submit-survey', { method: 'POST', body: surveyData }),
    },

    // 3. User & Account Profile
    profile: {
      get: () => rawRequest('/profile'),
      update: (patch) => rawRequest('/profile', { method: 'PATCH', body: patch }),
      changePassword: (currentPassword, newPassword) => rawRequest('/profile/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
      uploadPhoto: (file) => {
        const form = new FormData();
        form.append('file', file);
        return rawRequest('/profile/photo', { method: 'POST', body: form, isFormData: true });
      },
      checkUsername: (username) => rawRequest(`/public/usernames/${encodeURIComponent(username)}`),
    },

    // 4. Role Dashboards & Profiles
    roles: {
      getDashboard: (role) => rawRequest(`/dashboard/${encodeURIComponent(role)}`),
      getProfile: (role) => rawRequest(`/${encodeURIComponent(role)}/profile`),
      updateProfile: (role, data) => rawRequest(`/${encodeURIComponent(role)}/profile`, { method: 'PUT', body: data }),
    },

    // 5. Visiting Card Studio
    cards: {
      get: (cardId = null) => rawRequest(`/student/card${cardId ? `?cardId=${encodeURIComponent(cardId)}` : ''}`),
      create: (templateId, designName) => rawRequest('/student/card', { method: 'POST', body: { action: 'create', templateId, designName } }),
      duplicate: (sourceCardId) => rawRequest('/student/card', { method: 'POST', body: { action: 'duplicate', sourceCardId } }),
      save: (cardId, patch) => rawRequest('/student/card', { method: 'PUT', body: { cardId, ...patch } }),
      delete: (cardId) => rawRequest(`/student/card?cardId=${encodeURIComponent(cardId)}`, { method: 'DELETE' }),
      publish: (cardId, setAsDefault = false) => rawRequest('/student/card/publish', { method: 'POST', body: { cardId, setAsDefault } }),
      unpublish: (cardId) => rawRequest('/student/card/unpublish', { method: 'POST', body: { cardId } }),
      uploadAsset: (file) => {
        const form = new FormData();
        form.append('file', file);
        return rawRequest('/student/card/upload', { method: 'POST', body: form, isFormData: true });
      },
      getQrUrl: (username, format = 'svg') => `${getBaseUrl()}/student/card/qr?username=${encodeURIComponent(username)}&format=${format}`,
    },

    // 6. Certificates & Verification
    certificates: {
      submit: (payload) => rawRequest('/student/certificates', { method: 'POST', body: payload }),
      get: (id) => rawRequest(`/student/certificates/${encodeURIComponent(id)}`),
      verify: (id) => rawRequest(`/student/certificates/${encodeURIComponent(id)}/verify`, { method: 'POST', timeoutMs: 30000 }),
    },

    // 7. Resume Extraction & LLM Pipeline
    resume: {
      extract: (file) => {
        const form = new FormData();
        form.append('file', file);
        return rawRequest('/student/resume/extract', {
          method: 'POST',
          body: form,
          isFormData: true,
          timeoutMs: 90000, // 90s deadline for full extraction & repair pipeline
          retries: 0,       // Never duplicate LLM charges
        });
      },
      getReview: (reviewId) => rawRequest(`/student/resume/reviews/${encodeURIComponent(reviewId)}`),
      discardReview: (reviewId) => rawRequest(`/student/resume/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE' }),
      apply: (reviewId, selections) => rawRequest('/student/resume/apply', { method: 'POST', body: { reviewId, selections } }),
    },

    // 8. Website Builder & Portfolio Revisions
    website: {
      getConfig: () => rawRequest('/student/website/config'),
      saveConfig: (payload) => rawRequest('/student/website/config', { method: 'PUT', body: payload }),
      getPreview: () => rawRequest('/student/website/preview'),
      publish: () => rawRequest('/student/website/publish', { method: 'POST' }),
      getHistory: () => rawRequest('/student/website/history'),
      rollback: (revisionId) => rawRequest('/student/website/rollback', { method: 'POST', body: { revisionId } }),
    },

    // 9. Analytics Engine
    analytics: {
      track: (type, resourceId, resourceType = 'profile', metadata = {}) => rawRequest('/analytics/events', {
        method: 'POST',
        body: { type, resourceId, resourceType, metadata },
        retries: 0,
      }).catch(() => null),
      getOverview: () => rawRequest('/analytics/overview'),
    },

    // 10. Public Endpoints
    public: {
      getProfile: (username, view = 'recruiter') => rawRequest(`/public/profile/${encodeURIComponent(username)}?view=${encodeURIComponent(view)}`),
      getCard: (username) => rawRequest(`/public/card/${encodeURIComponent(username)}`),
      checkUsername: (username) => rawRequest(`/public/usernames/${encodeURIComponent(username)}`),
    },
  };

  window.OV_API = api;
  if (window.OV) {
    window.OV.api = api;
  }
})();
