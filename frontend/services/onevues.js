/* onevues service — audience-specific filtered views of one profile. */
(function () {
  const { db, http, latency, isLive } = window.OV.core;

  /** Each onevue declares which profile sections it reveals, in order. */
  const ONEVUES = [
    { id: 'recruiter', label: 'Recruiter', blurb: 'Experience, skills and verified employers. No rates, no personal phone.', sections: ['summary', 'experience', 'skills', 'credentials', 'availability'] },
    { id: 'client', label: 'Client', blurb: 'Services, case studies and reviews. Employment history stays private.', sections: ['summary', 'services', 'portfolio', 'testimonials', 'contact'] },
    { id: 'college', label: 'College', blurb: 'Education, activities and verified transcripts, framed for admissions.', sections: ['education', 'activities', 'credentials', 'skills'] },
    { id: 'contact', label: 'Contact', blurb: 'Just the essentials: name, role and the ways to reach you.', sections: ['contact'] },
    { id: 'business', label: 'Business', blurb: 'Partnership-ready: offerings, track record and verified identity.', sections: ['summary', 'services', 'experience', 'credentials'] },
  ];

  async function listOnevues() {
    if (isLive()) return http('GET', '/onevues');
    return ONEVUES;
  }

  /** Returns the subset of profile data visible to a onevue. Sections resolved here, not in UI. */
  async function renderOnevue(profile, onevueId) {
    if (isLive()) return http('GET', '/profiles/' + profile.username + '/onevues/' + onevueId);
    await latency(60, 140);
    const onevue = ONEVUES.find(f => f.id === onevueId) || ONEVUES[0];
    const creds = db.filter('c:credentials', c => c.profileId === profile.id && c.status === 'verified');
    const pick = {
      summary: profile.summary, experience: profile.experience, education: profile.education,
      skills: profile.skills, portfolio: profile.portfolio, services: profile.services,
      testimonials: profile.testimonials, activities: profile.activities, availability: profile.availability,
      credentials: creds.filter(c => onevueId === 'college' ? ['Degree', 'Certification', 'Identity'].includes(c.kind) : true),
      contact: onevueId === 'contact' ? profile.links : { email: profile.links.email, web: profile.links.web },
    };
    return {
      onevue,
      header: { name: profile.name, headline: profile.headline, location: profile.location, initials: profile.avatarInitials, username: profile.username },
      sections: onevue.sections.map(key => ({ key, data: pick[key] })).filter(s => s.data && (!Array.isArray(s.data) || s.data.length)),
      hidden: ['summary', 'experience', 'education', 'skills', 'portfolio', 'services', 'testimonials', 'activities', 'credentials', 'contact'].filter(k => !onevue.sections.includes(k)),
    };
  }

  window.OV.services.onevues = { listOnevues, renderOnevue };
})();

