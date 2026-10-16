/* portfolio service — work items attached to a profile. */
(function () {
  const { db, http, latency, uid, isLive } = window.OV.core;
  const profileOf = id => db.find('c:profiles', p => p.id === id);

  async function listItems(profileId) {
    if (isLive()) return http('GET', '/profiles/' + profileId + '/portfolio');
    await latency(80, 160);
    const p = profileOf(profileId); return p ? p.portfolio : [];
  }
  async function addItem(profileId, item) {
    if (isLive()) return http('POST', '/profiles/' + profileId + '/portfolio', item);
    await latency();
    const p = profileOf(profileId); const rec = { id: uid('pi'), ...item };
    db.update('c:profiles', profileId, { portfolio: [...(p.portfolio || []), rec] }); return rec;
  }
  async function removeItem(profileId, itemId) {
    if (isLive()) return http('DELETE', '/profiles/' + profileId + '/portfolio/' + itemId);
    await latency();
    const p = profileOf(profileId);
    db.update('c:profiles', profileId, { portfolio: p.portfolio.filter(i => i.id !== itemId) }); return true;
  }
  window.OV.services.portfolio = { listItems, addItem, removeItem };
})();
