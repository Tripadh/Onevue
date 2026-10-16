/* Core data plumbing shared by every service. Components never import this. */
(function () {
  'use strict';
  const env = window.OV_ENV || { API_MODE: 'mock', API_URL: '', STORAGE_PREFIX: 'onevue:' };
  const prefix = env.STORAGE_PREFIX || 'onevue:';
  const mem = {};
  const ls = (() => {
    try { const k = '__ov_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  })();

  /** Tiny document store over localStorage (in-memory fallback). */
  const db = {
    get(key, fallback) {
      try {
        const raw = ls ? ls.getItem(prefix + key) : mem[key];
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try { if (ls) ls.setItem(prefix + key, raw); else mem[key] = raw; } catch (e) { mem[key] = raw; }
      return value;
    },
    remove(key) { try { if (ls) ls.removeItem(prefix + key); } catch (e) {} delete mem[key]; },
    list(collection) { return db.get('c:' + collection, []); },
    insert(collection, record) {
      const all = db.list(collection); all.push(record); db.set('c:' + collection, all); return record;
    },
    update(collection, id, patch) {
      const all = db.list(collection); const i = all.findIndex(r => r.id === id);
      if (i < 0) return null; all[i] = { ...all[i], ...patch }; db.set('c:' + collection, all); return all[i];
    },
    find(collection, pred) { return db.list(collection).find(pred) || null; },
    filter(collection, pred) { return db.list(collection).filter(pred); },
  };

  class ServiceError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  /** Live-mode HTTP client. Session token is attached automatically. */
  async function http(method, path, body) {
    const session = db.get('session', null);
    const res = await fetch(env.API_URL.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session && session.token ? { Authorization: 'Bearer ' + session.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    if (!res.ok) {
      let msg = 'Request failed (' + res.status + ')';
      try { const j = await res.json(); msg = j.message || msg; } catch (e) {}
      throw new ServiceError('http_' + res.status, msg);
    }
    return res.status === 204 ? null : res.json();
  }

  const latency = (min = 160, max = 420) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const isLive = () => env.API_MODE === 'live';

  window.OV = window.OV || {};
  window.OV.core = { env, db, http, latency, uid, isLive, ServiceError };
  window.OV.services = window.OV.services || {};
})();
