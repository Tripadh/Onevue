/* site service — marketing content (testimonials, pricing, FAQ) + UI preferences (theme). */
(function () {
  const { db, http, latency, isLive } = window.OV.core;

  const PLANS = [
    { id: 'free', name: 'Essential', price: 0, period: 'forever', line: 'Your link, your profile, the views that matter.', features: ['onevue.id/username', '3 audience onevues', 'QR code & vCard', '2 verified credentials'] },
    { id: 'pro', name: 'Signature', price: 8, period: 'per month', line: 'For people whose next opportunity depends on how they show up.', features: ['Unlimited onevues & links', 'All 5 themes + custom accent', 'Unlimited verified credentials', 'View analytics per audience', 'Expiring & private links'], featured: true },
    { id: 'biz', name: 'Atelier', price: 24, period: 'per month', line: 'Teams, studios and companies with a shared identity.', features: ['Business profile type', 'Team members & roles', 'Custom domain', 'Priority verification'] },
  ];

  const FAQ = [
    { q: 'What exactly is a onevue?', a: 'A onevue is a filtered view of your one profile. You decide which sections each audience sees: a recruiter gets your experience and verified employers, a client gets your services and case studies. Update your profile once and every onevue stays current.' },
    { q: 'How are credentials verified?', a: 'We confirm each credential with its issuer: registrar APIs for degrees, work email and HR confirmation for employment, issuer registries for certifications, and document plus liveness checks for identity. Every verified badge links to a signed verification trail anyone can re-check.' },
    { q: 'Can someone see sections I didn’t share?', a: 'No. Hidden sections are removed before the page is rendered, not just visually hidden. Each audience link only ever receives the data its onevue allows.' },
    { q: 'What happens to my link if I stop paying?', a: 'Your username and profile stay yours on the Essential plan. Signature features like extra onevues and analytics pause, and your links keep working.' },
    { q: 'Can I export or delete my data?', a: 'Yes. Export your full profile as JSON or PDF at any time, or delete your account permanently from settings. Deletion removes your public pages immediately.' },
    { q: 'Does Onevue replace LinkedIn or my portfolio site?', a: 'It sits above them. Link your existing profiles and work into one place, then share the right slice of it. Many people keep their other accounts and simply stop sending five different links.' },
  ];

  async function listTestimonials() {
    if (isLive()) return http('GET', '/site/testimonials');
    await latency(60, 140);
    return db.list('c:testimonials');
  }
  async function listPlans() { if (isLive()) return http('GET', '/site/plans'); return PLANS; }
  async function listFaq() { if (isLive()) return http('GET', '/site/faq'); return FAQ; }

  /** Theme preference is local UI state — always stored on device; synced to account in live mode. */
  function getThemePreference() { return db.get('pref:theme', 'sapphire'); }
  function setThemePreference(id) {
    db.set('pref:theme', id);
    if (isLive()) http('PATCH', '/me/preferences', { theme: id }).catch(() => {});
  }

  window.OV.services.site = { listTestimonials, listPlans, listFaq, getThemePreference, setThemePreference };
})();

