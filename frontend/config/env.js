/**
 * Onevue runtime configuration (.env equivalent).
 * API_MODE: 'mock' → services use the local browser database (localStorage).
 *           'live' → services call API_URL. Only /services needs to know.
 */
window.OV_ENV = {
  API_MODE: 'mock',           // 'mock' | 'live'
  API_URL: 'https://api.onevue.id/v1',
  PUBLIC_BASE: 'onevue.id',
  STORAGE_PREFIX: 'onevue:',
};
