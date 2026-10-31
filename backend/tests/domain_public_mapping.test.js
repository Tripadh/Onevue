/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Phase 4 regression coverage: domain mappers keep every supported public
 * field, record-level custom fields survive publish and the public allowlist,
 * identity sources produce their declared sections, and private domain data
 * never reaches the public DTO.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.join(__dirname, "..", "node_modules", "typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

const { domainProfileToPublicSource } = require(path.join(__dirname, "..", "lib", "domain-profile", "website-source.ts"));
const { toPublicProfileDTO, allowlistPublicSnapshot } = require(path.join(__dirname, "..", "lib", "public-profile-dto.ts"));
const { recordIdsForIdentity } = require(path.join(__dirname, "..", "lib", "custom-fields", "builtins.ts"));

const OWNER_ID = "a".repeat(24);
const ASSET_ID = "ast_" + "b".repeat(24);

function field(value, overrides = {}) {
  return {
    id: "fld_note0001",
    label: "Supporting note",
    type: "text",
    visibility: "public",
    order: 0,
    value,
    ...overrides,
  };
}

function publicDto(identity, profile, options = {}) {
  const source = domainProfileToPublicSource(identity, profile, {
    mode: options.mode || "publish",
    ownerId: OWNER_ID,
  });
  return toPublicProfileDTO(source, {
    username: "someone",
    identity,
    ownerId: OWNER_ID,
    assetDelivery: options.mode || "publish",
    recordIds: recordIdsForIdentity(identity, profile),
    strictCustomFields: false,
  });
}

function valuesOf(records) {
  return (records || []).flatMap((record) => (record.customFields || []).map((item) => item.value));
}

test("professional records keep custom fields through publish and the public allowlist", () => {
  const note = field("Prof note");
  const profile = {
    headline: "Engineer",
    skills: [{ id: "skill_1", name: "Kubernetes", customFields: [note] }],
    education: [{ id: "edu_1", institution: "State", degree: "BSc", customFields: [note] }],
    certifications: [{ id: "cert_1", title: "Cloud", issuer: "Example", customFields: [note] }],
    portfolio: [{ id: "proj_1", title: "Engine", description: "Built it", customFields: [note] }],
    achievements: [{ id: "ach_1", title: "Award", customFields: [note] }],
  };

  const dto = publicDto("professional", profile);
  assert.deepEqual(valuesOf(dto.skills), ["Prof note"]);
  assert.deepEqual(valuesOf(dto.education), ["Prof note"]);
  assert.deepEqual(valuesOf(dto.credentials), ["Prof note"]);
  assert.deepEqual(valuesOf(dto.projects), ["Prof note"]);
  assert.deepEqual(valuesOf(dto.achievements), ["Prof note"]);

  const listed = allowlistPublicSnapshot(JSON.parse(JSON.stringify(dto)));
  assert.deepEqual(valuesOf(listed.skills), ["Prof note"]);
  assert.deepEqual(valuesOf(listed.education), ["Prof note"]);
  assert.deepEqual(valuesOf(listed.credentials), ["Prof note"]);
  assert.deepEqual(valuesOf(listed.projects), ["Prof note"]);
  assert.deepEqual(valuesOf(listed.achievements), ["Prof note"]);
});

test("freelancer records keep custom fields and technology ids are value-stable", () => {
  const note = field("Free note");
  const profile = {
    headline: "Designer",
    technologies: ["Figma", "JavaScript"],
    services: [{ id: "service_1", name: "Logo", customFields: [note] }],
    portfolio: [{ id: "work_1", title: "Rebrand", summary: "Done", customFields: [note] }],
    workExperience: [{ id: "job_1", company: "Studio", jobTitle: "Designer", customFields: [note] }],
    testimonials: [{ id: "quote_1", quote: "Great", authorName: "Client", customFields: [note] }],
    workSamples: [{ id: "sample_1", title: "Mock", url: "https://example.com/mock", customFields: [note] }],
  };

  const dto = publicDto("freelancer", profile);
  assert.deepEqual(valuesOf(dto.projects), ["Free note", "Free note"]);
  assert.deepEqual(valuesOf(dto.experience), ["Free note"]);
  assert.deepEqual(valuesOf(dto.testimonials), ["Free note"]);
  assert.deepEqual(valuesOf(dto.media), ["Free note"]);

  const techIdByName = Object.fromEntries(dto.skills.map((skill) => [skill.name, skill.id]));
  assert.equal(techIdByName.Figma, "tech_figma");
  assert.equal(techIdByName.JavaScript, "tech_javascript");
  assert.equal(techIdByName.Figma, techIdByName.Figma);

  const reordered = publicDto("freelancer", { ...profile, technologies: ["JavaScript", "Figma"] });
  const reorderedIdByName = Object.fromEntries(reordered.skills.map((skill) => [skill.name, skill.id]));
  assert.equal(reorderedIdByName.Figma, "tech_figma");
  assert.equal(reorderedIdByName.JavaScript, "tech_javascript");

  const listed = allowlistPublicSnapshot(JSON.parse(JSON.stringify(dto)));
  assert.deepEqual(valuesOf(listed.projects), ["Free note", "Free note"]);
  assert.deepEqual(valuesOf(listed.experience), ["Free note"]);
  assert.deepEqual(valuesOf(listed.testimonials), ["Free note"]);
  assert.deepEqual(valuesOf(listed.media), ["Free note"]);
});

test("creator content categories feed skills and featured images feed media", () => {
  const note = field("Creator note");
  const profile = {
    displayName: "Cora",
    niche: "Technology",
    contentCategories: ["AI", "Open source"],
    featuredContent: [{
      id: "content_1",
      title: "Launch essay",
      url: "https://cora.example/launch",
      thumbnailUrl: "https://cdn.example/cora.jpg",
      customFields: [note],
    }],
    pastCollaborations: [{ id: "collab_1", organization: "Northwind", title: "Spring", customFields: [note] }],
    audienceStats: [{ id: "stat_1", platform: "Video", metric: "subscribers", value: 1200, customFields: [note] }],
  };

  const dto = publicDto("creator", profile);
  assert.deepEqual(dto.skills.map((skill) => skill.name), ["AI", "Open source"]);
  assert.deepEqual(valuesOf(dto.projects), ["Creator note"]);
  assert.equal(dto.media.length, 1);
  assert.equal(dto.media[0].mediaUrl, "https://cdn.example/cora.jpg");
  assert.deepEqual(valuesOf(dto.media), ["Creator note"]);
  assert.deepEqual(valuesOf(dto.achievements), ["Creator note", "Creator note"]);

  const listed = allowlistPublicSnapshot(JSON.parse(JSON.stringify(dto)));
  assert.deepEqual(valuesOf(listed.projects), ["Creator note"]);
  assert.deepEqual(valuesOf(listed.media), ["Creator note"]);
  assert.deepEqual(valuesOf(listed.achievements), ["Creator note", "Creator note"]);
  assert.deepEqual(listed.skills.map((skill) => skill.name), ["AI", "Open source"]);
});

test("business records keep custom fields and branding feeds media", () => {
  const note = field("Business note");
  const profile = {
    businessName: "Reed Goods",
    products: [{ id: "product_1", name: "Lamp", price: 80, currency: "USD", customFields: [note] }],
    services: [{ id: "service_1", name: "Install", customFields: [note] }],
    caseStudies: [{ id: "case_1", title: "Studio rollout", customFields: [note] }],
    credentials: [{ id: "cred_1", title: "Design prize", customFields: [note] }],
    team: [{ id: "team_1", name: "Public Lead", role: "Founder", isPublic: true, customFields: [note] }],
    branding: { logoUrl: "https://cdn.example/logo.png", customFields: [field("Brand note")] },
  };

  const dto = publicDto("business", profile);
  assert.deepEqual(valuesOf(dto.projects), ["Business note", "Business note", "Business note"]);
  assert.deepEqual(valuesOf(dto.credentials), ["Business note"]);
  assert.deepEqual(valuesOf(dto.team), ["Business note"]);
  assert.equal(dto.media.length, 1);
  assert.equal(dto.media[0].mediaUrl, "https://cdn.example/logo.png");
  assert.deepEqual(valuesOf(dto.media), ["Brand note"]);

  const listed = allowlistPublicSnapshot(JSON.parse(JSON.stringify(dto)));
  assert.deepEqual(valuesOf(listed.projects), ["Business note", "Business note", "Business note"]);
  assert.deepEqual(valuesOf(listed.team), ["Business note"]);
  assert.deepEqual(valuesOf(listed.media), ["Brand note"]);
});

test("private custom fields and private domain data never reach the public DTO", () => {
  const profile = {
    displayName: "Private Person",
    headline: "Headline",
    skills: [{ id: "skill_1", name: "Skill", customFields: [field("hidden", { visibility: "private" })] }],
    products: [{ id: "product_1", name: "Product", customFields: [field("shown")] }],
    team: [
      { id: "team_1", name: "Public", role: "Lead", isPublic: true },
      { id: "team_2", name: "Hidden Member", role: "Ops", isPublic: false },
    ],
    resources: [
      { id: "resource_1", title: "Public", url: "https://example.com/public", visibility: "public" },
      { id: "resource_2", title: "Internal", url: "https://example.com/internal", visibility: "private" },
    ],
    registration: { registrationNumber: "REG-SECRET-1", documentStorageKey: "hidden/key" },
    publicContact: { email: "hidden@example.com", visibility: { email: "private", phone: "private" } },
  };

  const dto = publicDto("business", profile);
  const dump = JSON.stringify(dto);
  assert.equal(dump.includes("hidden"), false);
  assert.equal(dump.includes("Hidden Member"), false);
  assert.equal(dump.includes("https://example.com/internal"), false);
  assert.equal(dump.includes("REG-SECRET-1"), false);
  assert.equal(dump.includes("hidden/key"), false);
  assert.equal(dump.includes("hidden@example.com"), false);
  assert.equal(dto.team.length, 1);
});

test("professional resume is public only with explicit visibility and an http URL", () => {
  const allowed = publicDto("professional", {
    headline: "Engineer",
    resume: {
      visibility: "public",
      url: "https://example.com/cv.pdf",
      fileName: "cv.pdf",
      targetRole: "Staff Engineer",
      storageKey: "private/key",
      assetId: ASSET_ID,
    },
  });
  assert.equal(allowed.resume.url, "https://example.com/cv.pdf");
  assert.equal(allowed.resume.fileName, "cv.pdf");
  const dump = JSON.stringify(allowed);
  assert.equal(dump.includes("private/key"), false);
  assert.equal(dump.includes(ASSET_ID), false);

  const privateResume = publicDto("professional", {
    headline: "Engineer",
    resume: { visibility: "private", url: "https://example.com/cv.pdf", fileName: "cv.pdf" },
  });
  assert.equal(privateResume.resume, undefined);

  const uploadedOnly = publicDto("professional", {
    headline: "Engineer",
    resume: { storageKey: "private/key", assetId: ASSET_ID, fileName: "cv.pdf" },
  });
  assert.equal(uploadedOnly.resume, undefined);
  assert.equal(JSON.stringify(uploadedOnly).includes(ASSET_ID), false);
});

test("publish and preview deliver uploaded assets through their safe routes", () => {
  const profile = {
    headline: "Engineer",
    portfolio: [{ id: "proj_1", title: "Engine", assetId: ASSET_ID }],
  };

  const published = publicDto("professional", profile, { mode: "publish" });
  assert.equal(published.projects[0].imageUrl, `/api/assets/public/${ASSET_ID}`);

  const previewed = publicDto("professional", profile, { mode: "preview" });
  assert.match(previewed.projects[0].imageUrl, new RegExp(`^/api/assets/private/${ASSET_ID}\\?exp=\\d{1,12}&sig=[a-f0-9]{64}$`));

  const listedPublished = allowlistPublicSnapshot(JSON.parse(JSON.stringify(published)));
  assert.equal(listedPublished.projects[0].imageUrl, `/api/assets/public/${ASSET_ID}`);
});
