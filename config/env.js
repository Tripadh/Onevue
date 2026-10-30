/**
 * Onevue runtime configuration (.env equivalent).
 * API_MODE: 'mock' → services use the local browser database (localStorage).
 *           'live' → services call API_URL. Only /services needs to know.
 */
window.OV_ENV = {
  API_MODE: 'live',           // 'mock' | 'live'
  API_URL: 'http://localhost:3000/api',
  API_BASE: 'http://localhost:3000/api',
  PUBLIC_BASE: 'onevue.id',
  STORAGE_PREFIX: 'onevue:',
};
