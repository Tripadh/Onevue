/**
 * Onevue runtime configuration (.env equivalent).
 * API_MODE: 'mock' → services use the local browser database (localStorage).
 *           'live' → services call API_URL. Only /services needs to know.
 * API_BASE: platform backend (Next.js) used by authentication and other
 *           browser requests while API_MODE is mock.
 */
window.OV_ENV = {
  API_MODE: 'mock',           // 'mock' | 'live'
  API_URL: 'https://api.onevue.id/v1',
  API_BASE: 'http://localhost:3000/api',
  PUBLIC_BASE: 'onevue.id',
  STORAGE_PREFIX: 'onevue:',
};
