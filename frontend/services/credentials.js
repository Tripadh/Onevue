/* credentials service — verified degrees, employment, certifications, identity. */
(function () {
  const { db, http, latency, isLive, ServiceError } = window.OV.core;

  async function listCredentials(profileId) {
    if (isLive()) return http('GET', '/profiles/' + profileId + '/credentials');
    await latency(100, 220);
    return db.filter('c:credentials', c => c.profileId === profileId);
  }

  /** Re-checks a credential with its issuer. Returns a step-by-step verification trail. */
  async function verify(credentialId) {
    if (isLive()) return http('POST', '/credentials/' + credentialId + '/verify');
    await latency(700, 1100);
    const c = db.find('c:credentials', x => x.id === credentialId);
    if (!c) throw new ServiceError('not_found', 'Credential not found.');
    const at = new Date();
    return {
      credential: c, checkedAt: at.toISOString(),
      trail: [
        { step: 'Issuer identity confirmed', detail: c.issuer },
        { step: 'Record matched', detail: c.kind + ' · issued ' + new Date(c.issued).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) },
        { step: 'Signature valid', detail: 'Ed25519 · ' + c.id.toUpperCase() + '-' + at.getFullYear() },
        { step: 'Not revoked', detail: 'Checked ' + at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) },
      ],
    };
  }

  window.OV.services.credentials = { listCredentials, verify };
})();
