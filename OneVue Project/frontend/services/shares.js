/* shares service — audience links, QR payloads, expiry. */
(function () {
  const { db, http, latency, uid, isLive, env } = window.OV.core;

  /** Builds the public URL for a username + optional onevue. */
  function buildUrl(username, onevueId) {
    return env.PUBLIC_BASE + '/' + username + (onevueId ? '/' + onevueId : '');
  }

  /** Creates a trackable audience link. @returns {Promise<Share>} */
  async function createShare({ username, onevueId, label, expiresInDays }) {
    if (isLive()) return http('POST', '/shares', { username, onevueId, label, expiresInDays });
    await latency(200, 380);
    const code = Math.random().toString(36).slice(2, 7);
    const share = {
      id: uid('sh'), username, onevueId, label: label || null, code,
      url: buildUrl(username, onevueId) + '?s=' + code,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 864e5).toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    db.insert('c:shares', share); return share;
  }

  async function listShares(username) {
    if (isLive()) return http('GET', '/shares?username=' + encodeURIComponent(username));
    return db.filter('c:shares', s => s.username === username);
  }

  /**
   * Deterministic QR-style module matrix for a URL (visual preview in mock mode;
   * live mode should return a real encoded matrix or SVG from the backend).
   * @returns {Promise<boolean[][]>}
   */
  async function qrMatrix(url, size = 25) {
    if (isLive()) return http('GET', '/qr?size=' + size + '&data=' + encodeURIComponent(url));
    let h = 2166136261; for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const m = Array.from({ length: size }, () => Array(size).fill(false));
    const finder = (r, c) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) m[r + i][c + j] = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4); };
    const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!inFinder(r, c)) m[r][c] = (r === 6 || c === 6) ? (r + c) % 2 === 0 : rnd() > 0.52;
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    return m;
  }

  window.OV.services.shares = { buildUrl, createShare, listShares, qrMatrix };
})();
