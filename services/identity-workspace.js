/* Maps professional, freelancer, creator, and business profiles into the fields the
   shared visiting-card and website pages read (headline, bio, education, projects,
   skills, contacts). Mirrors backend/lib/domain-profile/website-source.ts. */
(function () {
  window.OV = window.OV || {};

  function str(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function list(value) {
    return Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
  }

  function project(title, description, url, type) {
    return { title: title, shortDescription: description, liveUrl: url, projectType: type, technologies: [] };
  }

  const MAPPERS = {
    professional: function (p) {
      const job = p.currentEmployment || {};
      const contact = p.contact || {};
      return {
        headline: str(p.headline),
        bio: str(p.bio),
        education: list(p.education),
        projects: list(p.portfolio).map((i) => project(str(i.title), str(i.description), str(i.url), "portfolio")),
        skills: list(p.skills),
        organization: str(job.company),
        role: str(job.jobTitle),
        contacts: { phone: str(contact.phone), linkedin: str(contact.linkedin) },
      };
    },
    freelancer: function (p) {
      const contact = p.contact || {};
      const technologies = (Array.isArray(p.technologies) ? p.technologies : []).map((name) => ({ name: name }));
      return {
        headline: str(p.headline),
        bio: str(p.bio),
        education: [],
        projects: list(p.services)
          .map((s) => project(str(s.name), str(s.description), "", "service"))
          .concat(list(p.portfolio).map((i) => project(str(i.title), str(i.summary), str(i.url), "case-study"))),
        skills: list(p.skills).concat(technologies),
        organization: str(p.specialization),
        role: str(p.availability),
        contacts: { phone: str(contact.phone) },
      };
    },
    creator: function (p) {
      return {
        headline: str(p.niche),
        bio: str(p.bio),
        education: [],
        projects: list(p.featuredContent).map((f) => project(str(f.title), str(f.summary), str(f.url), str(f.format))),
        skills: (Array.isArray(p.contentCategories) ? p.contentCategories : []).map((name) => ({ name: name })),
        organization: (Array.isArray(p.contentCategories) && p.contentCategories[0]) || "",
        role: str(p.niche),
        contacts: {},
      };
    },
    business: function (p) {
      const contact = p.publicContact || {};
      return {
        headline: [str(p.industry), str(p.organizationType).replace(/_/g, " ")].filter(Boolean).join(" · "),
        bio: [str(p.description), str(p.mission)].filter(Boolean).join("\n\n"),
        education: [],
        projects: list(p.products)
          .map((i) => project(str(i.name), str(i.description), str(i.url), "product"))
          .concat(list(p.services).map((i) => project(str(i.name), str(i.description), "", "service")))
          .concat(list(p.caseStudies).map((i) => project(str(i.title), str(i.summary), str(i.url), "case-study"))),
        skills: [],
        organization: str(p.businessName),
        role: str(p.industry),
        contacts: { phone: str(contact.phone) },
      };
    },
  };

  function toWorkspaceProfile(identity, profile, user) {
    const mapper = MAPPERS[identity];
    if (!mapper || !profile) return null;
    const mapped = mapper(profile);
    const name = identity === "business" ? str(profile.businessName) || str(user && user.name) : str(user && user.name);
    return Object.assign(mapped, { name: name, updatedAt: profile.updatedAt || null });
  }

  /* The visiting-card editor reads the primary education entry for its organization and role lines. */
  function toCardProfile(identity, profile, user) {
    const base = toWorkspaceProfile(identity, profile, user);
    if (!base || base.education.length || !(base.organization || base.role)) return base;
    return Object.assign({}, base, { education: [{ institution: base.organization, degree: base.role }] });
  }

  window.OV.identityWorkspace = { toWorkspaceProfile: toWorkspaceProfile, toCardProfile: toCardProfile };
})();
