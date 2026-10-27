/* Student identity onboarding steps. Plain script so the page and node tests share it. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.OV = root.OV || {};
    root.OV.studentOnboarding = api;
  }
})(typeof window !== "undefined" ? window : null, function () {
  const STEPS = ["choice", "extract", "profile", "resume"];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function same(left, right) {
    return text(left).toLowerCase() === text(right).toLowerCase();
  }

  function profileHasContent(profile) {
    if (!profile) return false;
    if (text(profile.headline) || text(profile.bio)) return true;
    return ["education", "projects", "skills", "credentials", "achievements", "links"].some(function (key) {
      return Array.isArray(profile[key]) && profile[key].length > 0;
    });
  }

  function resolveStep(input) {
    const profile = input && input.profile;
    const done = Boolean(input && input.done);
    const savedStep = input && input.savedStep;
    if (done) return null;
    if (STEPS.indexOf(savedStep) !== -1) {
      if (savedStep === "choice" && profileHasContent(profile)) return null;
      return savedStep;
    }
    if (profileHasContent(profile)) return null;
    return "choice";
  }

  function goForward(step) {
    if (step === "choice") return "profile";
    if (step === "extract") return "profile";
    if (step === "profile") return "resume";
    return null;
  }

  function goBack(step) {
    if (step === "extract" || step === "profile") return "choice";
    if (step === "resume") return "profile";
    return "choice";
  }

  function emptyDraft() {
    return {
      headline: "",
      bio: "",
      contacts: { email: "", phone: "" },
      education: [],
      projects: [],
      skills: [],
      credentials: [],
      achievements: [],
      links: [],
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function groups(rows) {
    const map = new Map();
    (rows || []).forEach(function (row) {
      if (!row || !row.section) return;
      const key = row.section + ":" + row.entryIndex;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  function field(rows, name) {
    const match = (rows || []).find(function (row) { return row.field === name; });
    return match ? text(match.value) : "";
  }

  function applyExtraction(draft, rows) {
    const next = clone(draft && draft.headline !== undefined ? draft : emptyDraft());
    next.contacts = Object.assign({ email: "", phone: "" }, next.contacts || {});
    (rows || []).forEach(function (row) {
      if (!row || row.section !== "profile" || !text(row.value)) return;
      if (row.field === "headline") next.headline = text(row.value);
      if (row.field === "summary") next.bio = text(row.value);
      if (row.field === "email") next.contacts.email = text(row.value);
      if (row.field === "phone") next.contacts.phone = text(row.value);
    });

    groups(rows).forEach(function (entry, key) {
      const section = key.split(":")[0];
      if (section === "education") {
        const institution = field(entry, "institution");
        const degree = field(entry, "degree");
        if (!institution || !degree) return;
        const created = {
          institution: institution,
          degree: degree,
          currentStatus: "studying",
          verificationStatus: "self-reported",
        };
        ["fieldOfStudy", "startDate", "endDate"].forEach(function (name) {
          const value = field(entry, name);
          if (value) created[name] = value;
        });
        const grade = field(entry, "grade");
        if (/%/.test(grade)) created.percentage = grade;
        else if (grade) created.gpa = grade;
        const index = next.education.findIndex(function (item) {
          return same(item.institution, institution) && same(item.degree, degree);
        });
        if (index >= 0) next.education[index] = Object.assign({}, next.education[index], created);
        else next.education.push(created);
      }
      if (section === "projects") {
        const title = field(entry, "name");
        if (!title) return;
        const technologies = field(entry, "technologies");
        const link = field(entry, "links");
        const description = field(entry, "description");
        const created = {
          title: title,
          projectType: "academic",
          status: "completed",
        };
        if (description) created.shortDescription = description;
        if (technologies) {
          created.technologies = technologies.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
        }
        if (/github\.com/i.test(link)) created.repoUrl = link;
        else if (link) created.liveUrl = link;
        const index = next.projects.findIndex(function (item) { return same(item.title, title); });
        if (index >= 0) next.projects[index] = Object.assign({}, next.projects[index], created);
        else next.projects.push(created);
      }
      if (section === "skills") {
        const name = field(entry, "name");
        if (!name) return;
        if (next.skills.some(function (item) { return same(item.name, name); })) return;
        next.skills.push({
          name: name,
          category: "Other Skills",
          proficiency: "Intermediate",
        });
      }
      if (section === "credentials") {
        const title = field(entry, "title");
        if (!title) return;
        const created = {
          title: title,
          credentialType: "other",
          verificationStatus: "self-reported",
        };
        if (field(entry, "description")) created.description = field(entry, "description");
        const index = next.credentials.findIndex(function (item) { return same(item.title, title); });
        if (index >= 0) next.credentials[index] = Object.assign({}, next.credentials[index], created);
        else next.credentials.push(created);
      }
      if (section === "achievements") {
        const title = field(entry, "title");
        if (!title) return;
        const created = {
          title: title,
          category: "other",
          verificationStatus: "self-reported",
        };
        if (field(entry, "description")) created.description = field(entry, "description");
        const index = next.achievements.findIndex(function (item) { return same(item.title, title); });
        if (index >= 0) next.achievements[index] = Object.assign({}, next.achievements[index], created);
        else next.achievements.push(created);
      }
      if (section === "socialLinks") {
        const platform = field(entry, "platform");
        const url = field(entry, "url");
        if (!platform || !url) return;
        const index = next.links.findIndex(function (item) { return same(item.platform, platform); });
        if (index >= 0) next.links[index] = Object.assign({}, next.links[index], { url: url });
        else next.links.push({ platform: platform, url: url, category: "other", verificationStatus: "unverified" });
      }
    });
    return next;
  }

  return {
    STEPS: STEPS,
    profileHasContent: profileHasContent,
    resolveStep: resolveStep,
    goForward: goForward,
    goBack: goBack,
    emptyDraft: emptyDraft,
    applyExtraction: applyExtraction,
  };
});
