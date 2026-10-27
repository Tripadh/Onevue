/**
 * Template registry, content retention, and stored-text sanitizing.
 * Does not need MongoDB.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));
if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(compiled.outputText, filename);
  };
}

const contract = require(path.join(projectRoot, "lib", "templates", "contract.js"));
const registry = require(path.join(projectRoot, "lib", "templates", "registry.ts"));
const frontend = require(path.join(projectRoot, "..", "frontend", "services", "create-customize.js"));
const portfolioRegistry = require(path.join(projectRoot, "..", "portfolio", "src", "lib", "template-registry.ts"));
const { buildDomainUpdate } = require(path.join(projectRoot, "lib", "domain-profile", "validate.ts"));
const { professionalContract } = require(path.join(projectRoot, "lib", "domain-profile", "contracts.ts"));
const templatesRoute = require(path.join(projectRoot, "app", "api", "templates", "route.ts"));

describe("Create and customize contract", () => {
  test("only the magicui test adapter is registered", () => {
    const templates = contract.listTemplates();
    assert.deepEqual(templates.map((template) => template.id), ["magicui-portfolio"]);
    assert.equal(templates[0].role, "test-adapter");
    assert.equal(templates[0].presentation.accentColor, true);
    assert.equal(templates[0].presentation.themeMode, true);
    assert.equal(templates[0].presentation.sectionOrder, true);
    assert.equal(templates[0].presentation.typography, false);
    assert.equal(templates[0].presentation.entryOrder, true);
    assert.equal(templates[0].media.galleries, false);
    assert.equal(templates[0].media.privateAssets, false);
    assert.equal(contract.getTemplate("future-template"), null);
  });

  test("the browser registry matches the server registry", () => {
    assert.deepEqual(frontend.listTemplates(), contract.listTemplates());
    assert.deepEqual(
      frontend.CONTENT_SECTIONS.map((section) => section.id + ":" + section.identities.join(",")),
      contract.CONTENT_SECTIONS.map((section) => section.id + ":" + section.identities.join(","))
    );
  });

  test("the portfolio test adapter lists the same sections", () => {
    assert.deepEqual(
      Array.from(portfolioRegistry.MAGICUI_SUPPORTED_SECTIONS),
      contract.getTemplate("magicui-portfolio").supportedSections
    );
    assert.deepEqual(
      Array.from(portfolioRegistry.RETAINED_PUBLIC_FIELDS),
      contract.RETAINED_PUBLIC_FIELDS
    );
  });

  test("publication keeps content the test adapter cannot display", () => {
    const dto = {
      profile: {
        displayName: "Ada",
        bio: "Mathematician",
        languages: [{ language: "English", proficiency: "fluent" }],
        careerInterests: ["Research"],
        nationality: "British",
        currentStatus: "studying",
      },
      education: [{ institution: "Analytical Engines" }],
      projects: [],
      skills: [],
      credentials: [],
      achievements: [],
      media: [],
      contact: { socialLinks: [] },
    };
    const before = JSON.stringify(dto);
    const parts = contract.partitionPublication("magicui-portfolio", dto);
    assert.equal(JSON.stringify(dto), before);
    assert.ok(parts.displayed.includes("about"));
    assert.ok(parts.displayed.includes("education"));
    assert.deepEqual(parts.retained.sort(), ["careerInterests", "currentStatus", "languages", "nationality"]);
    assert.throws(() => contract.partitionPublication("not-a-template", dto), /not registered/);
  });

  test("identity profile fields the adapter does not publish stay on the profile", () => {
    const profile = {
      businessName: "Northwind",
      registration: { registrationNumber: "REG-9" },
      audienceStats: [],
    };
    assert.deepEqual(
      contract.retainedProfileKeys("magicui-portfolio", "business", profile),
      ["registration"]
    );
    assert.equal(profile.registration.registrationNumber, "REG-9");
    assert.deepEqual(contract.retainedProfileKeys("magicui-portfolio", "creator", { audienceStats: [{ metric: "views", value: 10 }] }), ["audienceStats"]);
  });

  test("stored text drops tags and dangerous links and keeps markdown", () => {
    const cleaned = contract.sanitizeStoredText('Hello <script>alert(1)</script> **bold** [ok](https://onevue.example) [bad](javascript:alert(1))');
    assert.equal(cleaned.includes("<script>"), false);
    assert.equal(cleaned.includes("javascript:"), false);
    assert.match(cleaned, /\*\*bold\*\*/);
    assert.match(cleaned, /\[ok\]\(https:\/\/onevue\.example\)/);
    assert.match(cleaned, /bad/);
    const walked = registry.sanitizeIncomingStrings({ bio: "<img src=x onerror=alert(1)>Notes", projects: [{ title: "<b>Lamp</b>" }] });
    assert.equal(walked.bio.includes("<img"), false);
    assert.match(walked.bio, /Notes/);
    assert.equal(walked.projects[0].title, "Lamp");
  });

  test("domain profile save sanitizes rich text without dropping sibling fields", () => {
    const update = buildDomainUpdate(
      { headline: "Engineer", bio: "Keep me" },
      { bio: "<b>Hello</b> [docs](https://example.com/docs) [x](javascript:alert(1))" },
      professionalContract,
      "507f1f77bcf86cd799439011"
    );
    assert.equal(update.bio.includes("<b>"), false);
    assert.match(update.bio, /Hello/);
    assert.match(update.bio, /https:\/\/example.com\/docs/);
    assert.equal(update.bio.includes("javascript:"), false);
    assert.equal(update.headline, undefined);
  });

  test("repeatable entry order is explicit and does not mutate the source list", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const moved = contract.reorderEntries(list, 2, -1);
    assert.deepEqual(moved.map((item) => item.id), ["a", "c", "b"]);
    assert.deepEqual(list.map((item) => item.id), ["a", "b", "c"]);
    assert.equal(contract.reorderEntries(list, 0, -1).length, 3);
  });

  test("each identity has its own stored sections", () => {
    const student = contract.contentForIdentity("student").map((section) => section.id);
    const business = contract.contentForIdentity("business").map((section) => section.id);
    assert.ok(student.includes("hackathons"));
    assert.equal(business.includes("hackathons"), false);
    assert.ok(business.includes("registration"));
    assert.ok(business.includes("products"));
    assert.ok(contract.contentForIdentity("creator").some((section) => section.id === "audienceStats"));
    assert.ok(contract.contentForIdentity("freelancer").some((section) => section.id === "testimonials"));
    assert.ok(contract.contentForIdentity("professional").some((section) => section.id === "experience"));
  });

  test("presentation settings are allowlisted and section order is completed", () => {
    const saved = contract.presentationForTemplate("magicui-portfolio", {
      accentColor: "#10b981",
      themeMode: "dark",
      visibleSections: ["contact", "about"],
      sectionOrder: ["contact", "skills", "contact"],
    });
    assert.equal(saved.accentColor, "#10b981");
    assert.equal(saved.themeMode, "dark");
    assert.deepEqual(saved.visibleSections, ["contact", "about"]);
    assert.equal(saved.sectionOrder[0], "contact");
    assert.equal(saved.sectionOrder[1], "skills");
    assert.equal(saved.sectionOrder.indexOf("contact"), saved.sectionOrder.lastIndexOf("contact"));
    assert.ok(saved.sectionOrder.includes("work"));
    assert.deepEqual(
      frontend.presentationForTemplate("magicui-portfolio", { accentColor: "#fff", themeMode: "light", sectionOrder: ["projects"] }),
      contract.presentationForTemplate("magicui-portfolio", { accentColor: "#fff", themeMode: "light", sectionOrder: ["projects"] })
    );
    assert.throws(() => contract.presentationForTemplate("magicui-portfolio", { visibleSections: ["secret"] }), /Unsupported section visibility/);
    assert.throws(() => contract.presentationForTemplate("magicui-portfolio", { accentColor: "blue" }), /hex/);
    assert.throws(() => contract.presentationForTemplate("future-template", {}), /not registered/);
  });

  test("a published revision's appearance wins over a later draft", () => {
    const published = contract.publishedCustomization(
      { accentColor: "#111111", themeMode: "light", visibleSections: ["about"], sectionOrder: ["about", "contact"] },
      { accentColor: "#eeeeee", themeMode: "dark", visibleSections: ["contact"], sectionOrder: ["contact"] },
      "magicui-portfolio"
    );
    assert.equal(published.accentColor, "#111111");
    assert.equal(published.themeMode, "light");
    assert.deepEqual(published.visibleSections, ["about"]);
    assert.equal(published.sectionOrder[0], "about");
    const legacy = contract.publishedCustomization(null, { accentColor: "#abcdef", themeMode: "dark", visibleSections: ["skills"] });
    assert.equal(legacy.accentColor, "#abcdef");
    assert.deepEqual(legacy.visibleSections, ["skills"]);
  });

  test("rollback uses a revision's appearance and not a newer draft when the revision has none", () => {
    const stored = contract.rollbackPresentation(
      { accentColor: "#111111", themeMode: "light", visibleSections: ["about"], sectionOrder: ["about", "contact"] },
      "magicui-portfolio"
    );
    assert.equal(stored.accentColor, "#111111");
    assert.equal(stored.themeMode, "light");
    const legacy = contract.rollbackPresentation(null, "magicui-portfolio");
    assert.equal(legacy.accentColor, "#3b82f6");
    assert.equal(legacy.themeMode, "system");
    assert.deepEqual(legacy.visibleSections, ["about", "education", "projects", "skills", "achievements", "contact"]);
    assert.deepEqual(
      frontend.rollbackPresentation(null, "magicui-portfolio"),
      contract.rollbackPresentation(null, "magicui-portfolio")
    );
    const liveLegacy = contract.publishedCustomization(null, { accentColor: "#abcdef", themeMode: "dark", visibleSections: ["skills"] });
    assert.equal(liveLegacy.accentColor, "#abcdef");
  });

  test("stored markdown markers survive sanitizing", () => {
    const cleaned = contract.sanitizeStoredText("## Title\n\n- item\n\n++line++ **bold** [docs](https://example.com) <u>no</u>");
    assert.match(cleaned, /## Title/);
    assert.match(cleaned, /- item/);
    assert.match(cleaned, /\+\+line\+\+/);
    assert.match(cleaned, /\*\*bold\*\*/);
    assert.equal(cleaned.includes("<u>"), false);
  });

  test("GET /api/templates returns only the registered test adapter", async () => {
    const response = await templatesRoute.GET(new Request("http://localhost/api/templates"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.templates.map((template) => template.id), ["magicui-portfolio"]);
    assert.equal(JSON.stringify(body).includes("privateAssets\":true"), false);
  });
});
