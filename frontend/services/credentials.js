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

  const API_BASE = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
  const CREDLY_HOST = 'www.credly.com';
  const CREDLY_BADGE_SEGMENT = 'badges';
  const MAX_CERTIFICATE_URL_LENGTH = 2048;
  const CREDENTIAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ENCODED_SEPARATOR = /%(?:2f|5c)/i;
  const WELL_FORMED_ENCODING = /^(?:[^%]|%[0-9a-fA-F]{2})*$/;

  function certificateUrlProblem(reason) {
    if (reason === 'missing') {
      return {
        ok: false,
        reason: 'missing',
        title: 'Verification URL required',
        message: 'Add a Credly badge link in Verification URL, then try again. Automatic verification accepts https://www.credly.com/badges/<id>.',
      };
    }
    if (reason === 'malformed') {
      return {
        ok: false,
        reason: 'malformed',
        title: 'Verification URL invalid',
        message: 'The saved link is not a valid http or https URL. Edit the credential and paste the full Credly badge link, such as https://www.credly.com/badges/<id>.',
      };
    }
    return {
      ok: false,
      reason: 'unsupported',
      title: 'Issuer link not supported',
      message: 'Automatic verification only accepts Credly badge links (https://www.credly.com/badges/<id>). Replace Verification URL with that link, or use Verify with Issuer to open the saved URL.',
    };
  }

  function isAbsoluteHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function submittedParts(input) {
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(input);
    if (scheme === null || scheme[1].toLowerCase() !== 'https') return null;
    const rest = scheme[2];
    if (!rest.startsWith('//')) return null;
    let hierarchical = rest.slice(2);
    const fragmentAt = hierarchical.indexOf('#');
    if (fragmentAt !== -1) hierarchical = hierarchical.slice(0, fragmentAt);
    const queryAt = hierarchical.indexOf('?');
    if (queryAt !== -1) hierarchical = hierarchical.slice(0, queryAt);
    const slashAt = hierarchical.indexOf('/');
    if (slashAt <= 0) return null;
    return { authority: hierarchical.slice(0, slashAt), path: hierarchical.slice(slashAt) };
  }

  function authorityHostname(authority) {
    if (
      authority.length === 0 ||
      authority.includes('@') ||
      authority.includes(':') ||
      authority.includes('%') ||
      authority.includes('\\') ||
      authority.includes('/') ||
      authority.endsWith('.')
    ) {
      return null;
    }
    const hostname = authority.toLowerCase();
    return hostname === CREDLY_HOST ? hostname : null;
  }

  function decodePathSegment(segment) {
    if (
      segment.length === 0 ||
      segment.includes('/') ||
      segment.includes('\\') ||
      ENCODED_SEPARATOR.test(segment) ||
      !WELL_FORMED_ENCODING.test(segment)
    ) {
      return null;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch (e) {
      return null;
    }
    if (
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\u0000') ||
      ENCODED_SEPARATOR.test(decoded)
    ) {
      return null;
    }
    return decoded;
  }

  function isSupportedCredlyBadgeUrl(input) {
    const parts = submittedParts(input);
    if (parts === null) return false;
    const hostname = authorityHostname(parts.authority);
    if (hostname === null || parts.path.includes('\\')) return false;
    let parsed;
    try {
      parsed = new URL(input);
    } catch (e) {
      return false;
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.hostname !== hostname ||
      parsed.pathname !== parts.path
    ) {
      return false;
    }
    const segments = parts.path.split('/');
    if (segments.length !== 3 || segments[0] !== '') return false;
    const badgeSegment = decodePathSegment(segments[1]);
    const credentialSegment = decodePathSegment(segments[2]);
    return badgeSegment === CREDLY_BADGE_SEGMENT && credentialSegment !== null && CREDENTIAL_UUID.test(credentialSegment);
  }

  /**
   * Checks a saved credential link against the certificate service contract:
   * one trimmed url string that is an absolute Credly badge link.
   * The returned url is that saved string. It is never rebuilt from a title,
   * credential id, or issuer name.
   */
  function classifyCertificateUrl(value) {
    const url = String(value || '').trim();
    if (!url) return certificateUrlProblem('missing');
    if (url.length > MAX_CERTIFICATE_URL_LENGTH || !isAbsoluteHttpUrl(url)) {
      return certificateUrlProblem('malformed');
    }
    if (!isSupportedCredlyBadgeUrl(url)) return certificateUrlProblem('unsupported');
    return { ok: true, reason: 'valid', url: url };
  }

  function prepareCertificateSubmission(credential) {
    const record = credential && typeof credential === 'object' ? credential : {};
    const verificationUrl = String(record.verificationUrl || '').trim();
    const credentialUrl = String(record.credentialUrl || '').trim();
    const source = verificationUrl ? 'verificationUrl' : (credentialUrl ? 'credentialUrl' : '');
    const classified = classifyCertificateUrl(verificationUrl || credentialUrl);
    return Object.assign({ source: source }, classified);
  }

  function profileSaveFeedback(response) {
    const result = response && typeof response === 'object' ? response : {};
    if (result.ok !== true) {
      return {
        ok: false,
        title: 'Failed to save',
        body: result.message || 'Could not save to database.',
      };
    }
    return {
      ok: true,
      profile: result.profile && typeof result.profile === 'object' ? result.profile : null,
      title: 'Saved to Database',
      body: 'Student records updated in MongoDB.',
    };
  }

  function credentialsFromSave(localList, saved) {
    if (saved && typeof saved === 'object' && Array.isArray(saved.credentials)) {
      return saved.credentials;
    }
    return Array.isArray(localList) ? localList : [];
  }

  function authHeaders() {
    const session = db.get('session', null);
    if (!session || !session.token) throw new ServiceError('unauthorized', 'Authentication required.');
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.token,
    };
  }

  async function readPlatform(res) {
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      throw new ServiceError('http_' + res.status, data.message || 'Certificate request failed.');
    }
    return data;
  }

  async function submitCertificate(url) {
    const res = await fetch(API_BASE + '/student/certificates', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url: url }),
    });
    return readPlatform(res);
  }

  async function getCertificate(id) {
    const res = await fetch(API_BASE + '/student/certificates/' + encodeURIComponent(id), {
      method: 'GET',
      headers: authHeaders(),
    });
    return readPlatform(res);
  }

  async function extractResume(file) {
    const session = db.get('session', null);
    if (!session || !session.token) throw new ServiceError('unauthorized', 'Authentication required.');
    const body = new FormData();
    body.append('file', file, file.name || 'resume.pdf');
    const res = await fetch(API_BASE + '/student/resume/extract', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.token },
      body: body,
    });
    return readPlatform(res);
  }

  async function applyResumeReview(payload) {
    const res = await fetch(API_BASE + '/student/resume/apply', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    return readPlatform(res);
  }

  async function discardResumeReview(reviewId) {
    const res = await fetch(API_BASE + '/student/resume/reviews/' + encodeURIComponent(reviewId), {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return readPlatform(res);
  }

  async function verifyCertificate(id, earnerEmail) {
    const email = typeof earnerEmail === 'string' ? earnerEmail.trim() : '';
    const res = await fetch(API_BASE + '/student/certificates/' + encodeURIComponent(id) + '/verify', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(email ? { earnerEmail: email } : {}),
    });
    return readPlatform(res);
  }

  /**
   * Maps a certificate-service record onto the badge the student sees.
   * Only VERIFIED is a verified badge. Pending and failed results stay unverified.
   */
  function displayCertificateStatus(certificate) {
    const status = certificate && certificate.status;
    const recipientMatch = certificate && certificate.recipientMatch;
    if (status === 'VERIFIED' && recipientMatch === 'matched') {
      return {
        verified: true,
        label: 'VERIFIED',
        detail: 'Issuer evidence confirmed this credential, and the earner email matches the badge recipient.',
      };
    }
    if (status === 'VERIFIED') {
      return {
        verified: false,
        label: 'Issuer confirmed',
        detail: recipientMatch === 'mismatched'
          ? 'The issuer confirmed this badge. The supplied earner email did not match, so it is not linked to this account.'
          : 'The issuer confirmed this badge. It is not linked to this account until an earner email matches the badge recipient.',
      };
    }
    if (status === 'UNVERIFIED') {
      return {
        verified: false,
        label: 'UNVERIFIED',
        detail: 'The issuer did not confirm this credential. It is not a verified badge.',
      };
    }
    if (status === 'PENDING') {
      return {
        verified: false,
        label: 'PENDING',
        detail: 'Not verified. Issuer evidence is unavailable or inconclusive, so this check cannot produce a verified badge.',
      };
    }
    return {
      verified: false,
      label: 'Not verified',
      detail: 'No certificate verification result is available.',
    };
  }

  window.OV.services.credentials = {
    listCredentials,
    verify,
    submitCertificate,
    getCertificate,
    verifyCertificate,
    extractResume,
    applyResumeReview,
    discardResumeReview,
    displayCertificateStatus,
    classifyCertificateUrl,
    prepareCertificateSubmission,
    profileSaveFeedback,
    credentialsFromSave,
  };
})();
