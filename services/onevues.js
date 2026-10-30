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
    return ONEVUES;
  }

  /** Returns the subset of profile data visible to a onevue. Sections resolved here, not in UI. */
  async function renderOnevue(profile, onevueId) {
    if (!profile) return null;
    const onevue = ONEVUES.find(f => f.id === onevueId) || ONEVUES[0];

    // Normalize name, headline, initials
    const name = profile.name || profile.username || 'User';
    const headline = profile.headline || (profile.summary ? String(profile.summary).slice(0, 80) : '');
    const location = typeof profile.location === 'object' && profile.location ? (profile.location.formatted || profile.location.city || '') : (profile.location || '');
    const initials = profile.avatarInitials || name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

    // Normalize skills (supports array of objects or strings)
    const rawSkills = Array.isArray(profile.skills) ? profile.skills : [];
    const skills = rawSkills.map(s => (typeof s === 'string' ? s : s?.name || s?.title || '')).filter(Boolean);

    // Normalize education
    const rawEdu = Array.isArray(profile.education) ? profile.education : [];
    const education = rawEdu.map((e, idx) => ({
      id: e.id || 'edu_' + idx,
      degree: e.degree || e.fieldOfStudy || 'Student',
      org: e.institution || e.org || '',
      period: e.startDate ? `${e.startDate} — ${e.endDate || 'Present'}` : (e.period || ''),
      note: e.coursework || e.honors || e.grade || e.note || '',
    }));

    // Normalize experience
    const rawExp = Array.isArray(profile.experience) ? profile.experience : [];
    const experience = rawExp.map((x, idx) => ({
      id: x.id || 'exp_' + idx,
      role: x.title || x.role || '',
      org: x.company || x.org || '',
      period: x.startDate ? `${x.startDate} — ${x.endDate || (x.isCurrent ? 'Present' : '')}` : (x.period || ''),
      note: Array.isArray(x.bullets) ? x.bullets.join(' • ') : (x.description || x.note || ''),
    }));

    // Normalize portfolio / projects
    const rawProjects = Array.isArray(profile.projects) ? profile.projects : (Array.isArray(profile.portfolio) ? profile.portfolio : []);
    const portfolio = rawProjects.map((p, idx) => ({
      id: p.id || 'p_' + idx,
      title: p.title || p.name || '',
      kind: p.projectType || p.kind || 'Project',
      metric: (p.technologies && p.technologies.slice(0, 3).join(', ')) || p.metric || '',
      note: p.shortDescription || p.description || '',
    }));

    // Normalize credentials
    const rawCreds = Array.isArray(profile.credentials) ? profile.credentials : [];
    const credentials = rawCreds.map((c, idx) => ({
      id: c.id || 'crd_' + idx,
      title: c.title || c.courseName || c.kind || 'Credential',
      issuer: c.issuer || 'Verified Authority',
      kind: c.kind || 'Certification',
      status: c.verificationStatus || c.status || 'verified',
    }));

    // Normalize contact links
    const links = profile.links || profile.socialLinks || {};
    const contact = {
      email: typeof links.email === 'string' ? links.email : (profile.email || ''),
      web: typeof links.web === 'string' ? links.web : (links.website || ''),
      github: typeof links.github === 'string' ? links.github : '',
      linkedin: typeof links.linkedin === 'string' ? links.linkedin : '',
    };

    const pick = {
      summary: profile.bio || profile.summary || '',
      experience,
      education,
      skills,
      portfolio,
      services: profile.services || [],
      testimonials: profile.testimonials || [],
      activities: profile.activities || [],
      availability: profile.availability || 'Available for opportunities',
      credentials: credentials.filter(c => onevueId === 'college' ? ['Degree', 'Certification', 'Identity'].includes(c.kind) || c.status === 'verified' : true),
      contact: onevueId === 'contact' ? contact : { email: contact.email, web: contact.web },
    };

    return {
      onevue,
      header: { name, headline, location, initials, username: profile.username || 'user' },
      sections: onevue.sections.map(key => ({ key, data: pick[key] })).filter(s => s.data && (!Array.isArray(s.data) || s.data.length)),
      hidden: ['summary', 'experience', 'education', 'skills', 'portfolio', 'services', 'testimonials', 'activities', 'credentials', 'contact'].filter(k => !onevue.sections.includes(k)),
    };
  }

  window.OV.services.onevues = { listOnevues, renderOnevue };
})();

