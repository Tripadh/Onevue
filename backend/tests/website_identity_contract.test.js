/**
 * Identity website contract: per-identity sections, defaults, migration, and the
 * public contract endpoint. Does not need MongoDB.
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

const identityWebsite = require(path.join(projectRoot, "lib", "website", "identity-contract.js"));
const contract = require(path.join(projectRoot, "lib", "templates", "contract.js"));
const route = require(path.join(projectRoot, "app", "api", "website", "contract", "route.ts"));

describe("identity website contract", () => {
  test("every identity has distinct, schema-backed sections", () => {
    const template = contract.getTemplate("magicui-portfolio");
    const contracts = identityWebsite.allIdentityContracts(template);
    const byId = Object.fromEntries(contracts.map((item) => [item.identity, item]));

    assert.deepEqual(contracts.map((item) => item.identity), identityWebsite.IDENTITIES);

    assert.ok(byId.student.sections.some((section) => section.id === "education"));
    assert.equal(byId.creator.sections.some((section) => section.id === "education"), false);
    assert.ok(byId.business.sections.some((section) => section.id === "products"));
    assert.equal(byId.student.sections.some((section) => section.id === "products"), false);
    assert.ok(byId.freelancer.sections.some((section) => section.id === "services"));
    assert.ok(byId.creator.sections.some((section) => section.id === "featured"));

    for (const item of contracts) {
      const ids = new Set(item.sections.map((section) => section.id));
      for (const id of item.defaultSections.visible) assert.ok(ids.has(id), `${item.identity} default ${id}`);
      for (const id of item.defaultSections.order) assert.ok(ids.has(id), `${item.identity} order ${id}`);
      for (const section of item.sections) {
        assert.ok(Array.isArray(section.sourcePaths) && section.sourcePaths.length > 0, `${item.identity}.${section.id}`);
      }
    }
    assert.notDeepEqual(byId.student.defaultSections.visible, byId.business.defaultSections.visible);
    assert.notDeepEqual(byId.creator.defaultSections.visible, byId.professional.defaultSections.visible);
  });

  test("legacy work and achievements ids migrate without losing meaning", () => {
    const migrated = identityWebsite.normalizeVisibleSections("student", ["about", "work", "achievements", "education"]);
    assert.ok(migrated.includes("experience"));
    assert.equal(migrated.includes("work"), false);
    assert.ok(migrated.includes("highlights"));
    assert.ok(migrated.includes("hackathons"));
    assert.ok(migrated.includes("credentials"));

    const order = identityWebsite.normalizeSectionOrder("student", ["contact", "work", "about"]);
    assert.deepEqual(order.slice(0, 3), ["contact", "experience", "about"]);
  });

  test("legacy project umbrella keeps project buckets visible", () => {
    const migrated = identityWebsite.normalizeVisibleSections("business", ["about", "projects", "contact"]);
    assert.ok(migrated.includes("products"));
    assert.ok(migrated.includes("services"));
    assert.ok(migrated.includes("caseStudies"));
    assert.ok(migrated.includes("featured") === false);
  });

  test("concrete project buckets win over the legacy umbrella", () => {
    const migrated = identityWebsite.normalizeVisibleSections("business", ["projects", "products", "team"]);
    assert.ok(migrated.includes("projects"));
    assert.ok(migrated.includes("products"));
    assert.ok(migrated.includes("team"));
    assert.equal(migrated.includes("services"), false);
    assert.equal(migrated.includes("caseStudies"), false);
  });

  test("section summaries do not resurrect a hidden bucket through the umbrella", () => {
    const template = contract.getTemplate("magicui-portfolio");
    const dto = {
      projects: [
        { id: "p1", projectType: "product", title: "Widget" },
        { id: "p2", projectType: "service", title: "Consulting" },
      ],
      contact: { email: "", socialLinks: [] },
    };
    const summary = identityWebsite.summarizeSections(
      "business",
      dto,
      ["projects", "products"],
      template.supportedSections
    );
    const byId = Object.fromEntries(summary.sections.map((section) => [section.id, section]));
    assert.equal(byId.products.enabled, true);
    assert.equal(byId.services.savedCount, 1);
    assert.equal(byId.services.enabled, false);
  });

  test("identity presentation uses identity defaults and rejects unknown sections", () => {
    const student = contract.presentationForTemplate("magicui-portfolio", {}, "student");
    assert.ok(student.visibleSections.includes("experience"));
    assert.equal(student.visibleSections.includes("work"), false);

    const creator = contract.presentationForTemplate("magicui-portfolio", {}, "creator");
    assert.equal(creator.visibleSections.includes("education"), false);
    assert.ok(creator.visibleSections.includes("featured"));

    assert.throws(
      () => contract.presentationForTemplate("magicui-portfolio", { visibleSections: ["secret"] }, "student"),
      /Unsupported section visibility/
    );
  });

  test("existing configurations migrate through presentationForTemplate", () => {
    const saved = contract.presentationForTemplate(
      "magicui-portfolio",
      {
        visibleSections: ["about", "work", "achievements", "contact"],
        sectionOrder: ["about", "work", "education"],
      },
      "professional"
    );
    assert.ok(saved.visibleSections.includes("experience"));
    assert.ok(saved.visibleSections.includes("credentials"));
    assert.ok(saved.visibleSections.includes("highlights"));
    assert.deepEqual(saved.sectionOrder.slice(0, 2), ["about", "experience"]);
  });

  test("camelCase catalog ids round-trip through normalization and presentation", () => {
    const template = contract.getTemplate("magicui-portfolio");

    for (const identity of identityWebsite.IDENTITIES) {
      const resolved = contract.getIdentityContract(identity, template.id);
      const camelSections = resolved.sections.map((section) => section.id).filter((id) => /[A-Z]/.test(id));

      for (const id of camelSections) {
        assert.equal(identityWebsite.canonicalSectionId(id.toLowerCase()), id, `${identity}.${id}`);
        assert.ok(identityWebsite.normalizeVisibleSections(identity, [id.toLowerCase()]).includes(id), identity);
        assert.ok(identityWebsite.normalizeSectionOrder(identity, [id.toLowerCase()]).includes(id), identity);
      }
    }

    const saved = contract.presentationForTemplate(
      "magicui-portfolio",
      { visibleSections: ["about", "casestudies", "contact"], sectionOrder: ["contact", "casestudies", "about"] },
      "freelancer"
    );
    assert.ok(saved.visibleSections.includes("caseStudies"));
    assert.equal(saved.visibleSections.includes("casestudies"), false);
    assert.equal(saved.sectionOrder[1], "caseStudies");

    const revalidated = contract.presentationForTemplate("magicui-portfolio", saved, "freelancer");
    assert.deepEqual(revalidated.visibleSections, saved.visibleSections);
    assert.deepEqual(revalidated.sectionOrder, saved.sectionOrder);

    const business = contract.presentationForTemplate(
      "magicui-portfolio",
      { visibleSections: ["about", "casestudies", "contact"] },
      "business"
    );
    assert.ok(business.visibleSections.includes("caseStudies"));
  });

  test("a template switch keeps valid settings and drops inapplicable sections", () => {
    const saved = contract.presentationForTemplate(
      "magicui-portfolio",
      {
        accentColor: "#10b981",
        themeMode: "dark",
        visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
        sectionOrder: ["contact", "education", "work", "about"],
      },
      "business"
    );
    assert.equal(saved.accentColor, "#10b981");
    assert.equal(saved.themeMode, "dark");
    assert.equal(saved.visibleSections.includes("education"), false);
    assert.equal(saved.visibleSections.includes("skills"), false);
    assert.ok(saved.visibleSections.includes("about"));
    assert.ok(saved.visibleSections.includes("contact"));
    assert.equal(saved.sectionOrder[0], "contact");
    assert.equal(saved.sectionOrder.includes("experience"), false);
    assert.equal(saved.sectionOrder.includes("education"), false);
    assert.ok(saved.sectionOrder.includes("about"));
  });

  test("template compatibility is reported for each identity", () => {
    const template = contract.getTemplate("magicui-portfolio");
    for (const identity of identityWebsite.IDENTITIES) {
      const resolved = contract.getIdentityContract(identity, template.id);
      assert.equal(resolved.templateCompatibility.supported, true, identity);
      const supported = new Set(template.supportedSections);
      for (const section of resolved.sections) {
        assert.equal(supported.has(section.id), true, `${identity}.${section.id}`);
      }
    }
  });

  test("section summaries distinguish saved, enabled, and template support", () => {
    const template = contract.getTemplate("magicui-portfolio");
    const dto = {
      profile: { displayName: "Acme", headline: "We build things", bio: "" },
      projects: [
        { id: "p1", projectType: "product", title: "Widget" },
        { id: "p2", projectType: "service", title: "Consulting" },
        { id: "p3", projectType: "case-study", title: "Migration" },
      ],
      education: [],
      skills: [],
      experience: [],
      credentials: [],
      achievements: [],
      testimonials: [],
      team: [{ id: "t1", name: "Ada" }],
      media: [],
      contact: { email: "", socialLinks: [] },
    };
    const summary = identityWebsite.summarizeSections(
      "business",
      dto,
      ["about", "products", "services", "team"],
      template.supportedSections
    );
    const byId = Object.fromEntries(summary.sections.map((section) => [section.id, section]));

    assert.equal(byId.products.savedCount, 1);
    assert.equal(byId.services.savedCount, 1);
    assert.equal(byId.caseStudies.savedCount, 1);
    assert.equal(byId.team.savedCount, 1);
    assert.equal(byId.media.savedCount, 0);
    assert.equal(byId.about.savedCount, 1);
    assert.equal(byId.contact.saved, false);

    assert.equal(byId.products.enabled, true);
    assert.equal(byId.caseStudies.enabled, false);
    assert.equal(byId.products.templateSupported, true);

    const reduced = identityWebsite.summarizeSections("business", dto, ["products"], ["about"]);
    const reducedProducts = reduced.sections.find((section) => section.id === "products");
    assert.equal(reducedProducts.templateSupported, false);
    assert.equal(reduced.liveSections, 0);
  });

  test("GET /api/website/contract serves validated contracts", async () => {
    const single = await route.GET(new Request("http://localhost/api/website/contract?identity=freelancer"));
    assert.equal(single.status, 200);
    const singleBody = await single.json();
    assert.equal(singleBody.success, true);
    assert.equal(singleBody.contracts.length, 1);
    assert.equal(singleBody.contracts[0].identity, "freelancer");
    assert.ok(singleBody.contracts[0].sections.some((section) => section.id === "services"));

    const all = await route.GET(new Request("http://localhost/api/website/contract"));
    const allBody = await all.json();
    assert.equal(allBody.success, true);
    assert.equal(allBody.contracts.length, 5);
    assert.equal(allBody.template.id, "magicui-portfolio");
  });
});
