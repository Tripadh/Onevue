/* notifications service — in-app inbox + waitlist/newsletter. */
(function () {
  const { db, http, latency, uid, isLive, ServiceError } = window.OV.core;

  async function list(userId) {
    if (isLive()) return http('GET', '/notifications');
    return db.filter('c:notifications', n => n.userId === userId).sort((a, b) => b.at - a.at);
  }
  async function push(userId, title, body) {
    if (isLive()) return null;
    return db.insert('c:notifications', { id: uid('nt'), userId, title, body, read: false, at: Date.now() });
  }
  async function markAllRead(userId) {
    if (isLive()) return http('POST', '/notifications/read-all');
    db.filter('c:notifications', n => n.userId === userId).forEach(n => db.update('c:notifications', n.id, { read: true }));
    return true;
  }
  /** Product-update subscription from the footer. */
  async function subscribe(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new ServiceError('invalid_email', 'Enter a valid email address.');
    if (isLive()) return http('POST', '/subscribe', { email: e });
    await latency(300, 600);
    const subs = db.get('c:subscribers', []);
    if (subs.includes(e)) return { email: e, already: true };
    db.set('c:subscribers', [...subs, e]); return { email: e, already: false };
  }
  window.OV.services.notifications = { list, push, markAllRead, subscribe };
})();
