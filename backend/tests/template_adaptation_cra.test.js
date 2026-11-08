/**
 * =========================================================================
 * OneVue Phase 7 — create-react-app adaptation strategy tests
 * =========================================================================
 *
 * Each test pins one defect that browser verification of the pinned CRA
 * artifact found, so a regression re-opens a documented failure rather than a
 * stylistic preference:
 *
 *   1. absolute /static/... asset URLs 404 under /templates/<id>/<version>/
 *   2. the bundle never reads __ONEVUE_DTO__, so student data is ignored
 *   3. original-author analytics/ads identifiers fire third-party requests
 *   4. unused CDN tags are dead runtime dependencies
 *   5. production source maps expose the original source
 *   6. PWA manifest icon paths are unresolvable
 *   7. duplicate/malformed head metadata
 *   8. service worker + precache files nothing ever registers
 *
 * Offline, fixture-based, and reusable: the fixture is a devfolio-shaped CRA
 * app, not the one repository that was audited.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ts = require("typescript");
if (!require.extensions[".ts"]) {
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
}

const { adaptTemplateSource } = require("../lib/template-adaptation.ts");
const {
  releaseAssetBasePath,
  readExportedNames,
  detectCraDevfolio,
  stripThirdPartyTracking,
  reviewExternalTags,
  prefixRootAbsoluteUrls,
  repairHeadMetadata,
  generateContentModuleSource,
  extractContentAssets,
  sanitizeAssets,
  hardenContentAccess,
} = require("../lib/template-adapters/cra-devfolio.ts");

function createFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cra-fixture-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const AUTHOR_NAME = "Aniket Kumar";

/** Mirrors the audited template's defects, in miniature. */
function craFiles(overrides = {}) {
  const files = {
    "package.json": JSON.stringify(
      {
        private: true,
        name: "portfolio",
        version: "1.0.0",
        homepage: "https://author.github.io",
        scripts: {
          build: "react-scripts build",
          start: "react-scripts start",
          predeploy: "npm run build",
          deploy: "gh-pages -b gh-pages -d build",
        },
        dependencies: {
          react: "^16.10.2",
          "react-dom": "^16.10.2",
          "react-router-dom": "^5.1.2",
          "react-scripts": "3.2.0",
        },
      },
      null,
      2
    ),
    "public/index.html": [
      "<!doctype html><html lang=\"en\"><head>",
      "<meta charset=\"utf-8\"/>",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>",
      `<meta name="${AUTHOR_NAME.split(" ")[0]}'s Portfolio" content="Portfolio content"/>`,
      `<meta property="og:title" content="${AUTHOR_NAME} Portfolio"/>`,
      "<meta name=\"description\" content=\"author bio\" property=\"og:description\">",
      "<link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"/icons/favicon-32x32.png\">",
      "<link rel=\"apple-touch-icon\" href=\"/icons/apple-touch-icon.png\">",
      "<link rel=\"manifest\" href=\"/manifest.json\">",
      "<link rel=\"manifest\" href=\"/manifest.json\"/>",
      "<script async src=\"https://www.googletagmanager.com/gtag/js?id=AW-825508380\"></script>",
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag(\"js\",new Date);gtag(\"config\",\"AW-825508380\")</script>",
      "<link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css\"/>",
      "<script async src=\"https://cdnjs.cloudflare.com/ajax/libs/animejs/2.0.2/anime.js\"></script>",
      "<script async src=\"https://cdnjs.cloudflare.com/ajax/libs/canvasjs/1.7.0/canvasjs.min.js\"></script>",
      "<script async src=\"https://code.iconify.design/1/1.0.4/iconify.min.js\"></script>",
      `<title>${AUTHOR_NAME}'s Portfolio</title>`,
      "</head><body><div id=\"root\"></div></body></html>",
    ].join(""),
    "public/manifest.json": JSON.stringify({
      name: "masterPortfolio",
      icons: [{ src: "/icons/android-icon-144x144.png", sizes: "144x144", type: "image/png" }],
    }),
    "public/icons/favicon-32x32.png": "png",
    "src/index.js": [
      'import React from "react";',
      'import ReactDOM from "react-dom";',
      'import "./assets/font-awesome/css/all.css";',
      'import App from "./App";',
      'import * as serviceWorker from "./serviceWorker";',
      "ReactDOM.render(<App />, document.getElementById(\"root\"));",
      "serviceWorker.unregister();",
    ].join("\n"),
    "src/serviceWorker.js": "export function unregister() {}",
    "src/App.js": 'import React from "react";\nimport Main from "./containers/Main";\nexport default function App() { return <Main />; }\n',
    "src/containers/Main.js": [
      'import React from "react";',
      'import { Route, Switch, BrowserRouter } from "react-router-dom";',
      'import Home from "../pages/Home";',
      'import Education from "../pages/Education";',
      "export default function Main() {",
      "  return (",
      '    <BrowserRouter basename="/">',
      "      <Switch>",
      '        <Route path="/" exact component={Home} />',
      '        <Route path="/education" component={Education} />',
      "      </Switch>",
      "    </BrowserRouter>",
      "  );",
      "}",
    ].join("\n"),
    "src/pages/Home.js": `export default function Home() { return <h1>${AUTHOR_NAME}</h1>; }`,
    "src/pages/Education.js": 'export default function Education() { return <div>edu</div>; }',
    "src/containers/Projects.js": [
      'import ProjectsData from "../shared/opensource/projects.json";',
      "export default function Projects() {",
      "  return <div>{ProjectsData.data.map((repo) => <span key={repo.id}>{repo.name}</span>)}</div>;",
      "}",
    ].join("\n"),
    "src/shared/opensource/projects.json": JSON.stringify({
      data: [{ id: "1", name: "AuthorRepo", createdAt: "2021-05-11", url: "https://github.com/author/x", description: "author work", isFork: false, languages: [] }],
    }),
    "src/shared/opensource/issues.json": JSON.stringify({
      data: [{ key: "author/1", title: "Author issue", link: "https://github.com/author/1", author: AUTHOR_NAME, repository: { nameWithOwner: "author/x" } }],
    }),
    "src/shared/opensource/pull_requests.json": JSON.stringify({
      data: [{ key: "author/9", title: "Author pull", link: "https://github.com/author/9", author: AUTHOR_NAME, repository: { nameWithOwner: "author/x" } }],
    }),
    "src/shared/opensource/organizations.json": JSON.stringify({ data: [] }),
    "src/containers/issues/Issues.js": [
      'import issuesData from "../../shared/opensource/issues.json";',
      "export default function Issues() { return <div>{issuesData.data.length}</div>; }",
    ].join("\n"),
    "src/containers/pullRequests/PullRequests.js": [
      'import pullRequestsData from "../../shared/opensource/pull_requests.json";',
      "export default function PullRequests() { return <div>{pullRequestsData.data.length}</div>; }",
    ].join("\n"),
    "src/containers/organizations/Organizations.js": [
      'import OrganizationsData from "../../shared/opensource/organizations.json";',
      "export default function Organizations() { return <div>{OrganizationsData.data.length}</div>; }",
    ].join("\n"),
    "src/assets/font-awesome/css/all.css": "/* bundled font awesome */",
    "src/assets/images/lpu.jpeg": "jpeg",
    "src/assets/images/oracle.png": "png",
    "src/assets/images/avatar.svg": "svg",
    "src/assets/images/projects_image.svg": "svg",
    "src/assets/images/blogs_image.svg": "svg",
    "src/portfolio.js": [
      "const settings = { isSplash: false };",
      "const seo = { title: \"" + AUTHOR_NAME + "'s Portfolio\", description: \"author bio\", og: { title: \"x\", type: \"website\", url: \"https://author.github.io/\" } };",
      `const greeting = { title: "${AUTHOR_NAME}", logo_name: "crypticani", nickname: "crypticani", subTitle: "DevOps Engineer", resumeLink: "https://author.github.io/files/r.pdf", portfolio_repository: "https://github.com/author", githubProfile: "https://github.com/author" };`,
      "const socialMediaLinks = [{ name: \"Github\", link: \"https://github.com/author\", fontAwesomeIcon: \"fa-github\", backgroundColor: \"#181717\" }];",
      "const skills = { data: [{ title: \"DevOps\", fileName: \"CloudInfraImg\", skills: [\"a\"], softwareSkills: [{ skillName: \"Linux\", fontAwesomeClassname: \"simple-icons:linux\", style: { color: \"#000\" } }] }] };",
      "const degrees = { degrees: [{ title: \"Lovely Professional University\", subtitle: \"MCA\", logo_path: \"lpu.jpeg\", alt_name: \"LPU\", duration: \"2021 - 2023\", descriptions: [\"x\"], website_link: \"https://lpu.in\" }] };",
      "const certifications = { certifications: [{ title: \"Oracle\", subtitle: \"- Oracle\", logo_path: \"oracle.png\", certificate_link: \"https://oracle\", alt_name: \"Oracle\", color_code: \"#810f0f\" }] };",
      "const experience = { title: \"Experience\", subtitle: \"Work, Internship and Volunteership\", description: \"author narrative\", header_image_path: \"experience.svg\", sections: [{ title: \"Work\", experiences: [{ title: \"DevOps Engineer\", company: \"AuthorCorp\", logo_path: \"oracle.png\", duration: \"2023 - Present\", location: \"Nowhere\", company_url: \"https://authorcorp\", desc: [\"secret\"] }] }] };",
      "const projectsHeader = { title: \"Projects\", description: \"author projects blurb\", avatar_image_path: \"projects_image.svg\" };",
      "const contactPageData = { contactSection: { title: \"Contact Me\", profile_image_path: \"avatar.svg\", description: \"author contact\" }, blogSection: { title: \"Blogs\", subtitle: \"author blogs\", link: \"https://author.hashnode.dev\", avatar_image_path: \"blogs_image.svg\" } };",
      "export { settings, seo, greeting, socialMediaLinks, skills, degrees, certifications, experience, projectsHeader, contactPageData };",
    ].join("\n"),
    "src/skills/UsesIconify.js": 'export const icon = "span.iconify";',
    // The devfolio SEO component reads the author's data as if it always
    // exists; with a real student profile both reads below throw.
    "src/components/seoHeader/SeoHeader.js": [
      'import { greeting, seo, socialMediaLinks, experience, certifications } from "../../portfolio.js";',
      "export function SeoHeader() {",
      "  let sameAs = [];",
      "  socialMediaLinks",
      "    .filter((media) => !(media.link.startsWith(\"tel\") || media.link.startsWith(\"mailto\")))",
      "    .forEach((media) => sameAs.push(media.link));",
      "  let mail = socialMediaLinks",
      "    .find((media) => media.link.startsWith(\"mailto\"))",
      "    .link.substring(\"mailto:\".length);",
      "  let JobTitle = experience.sections[0].experiences[0].title;",
      "  let JobCompany = experience.sections[0].experiences[0].company;",
      "  return <div>{mail}{JobTitle}{JobCompany}</div>;",
      "}",
    ].join("\n"),
    ...overrides,
  };
  return files;
}

async function adapt(files, options = {}) {
  const fixture = createFixture(files);
  const result = await adaptTemplateSource({
    sourceDir: fixture.dir,
    templateId: options.templateId || "portfolio",
    templateVersion: options.templateVersion || "1.0.0",
    ...(options.strategy ? { strategy: options.strategy } : {}),
  });
  return { fixture, result, adapted: result.adaptedDir };
}

/* =========================================================================
   Defect 1 — asset base path
   ========================================================================= */

describe("Phase 7 — create-react-app delivery compatibility", () => {
  it("targets the release asset base path through CRA homepage", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      assert.equal(result.status, "ADAPTED");
      const pkg = JSON.parse(fs.readFileSync(path.join(adapted, "package.json"), "utf8"));
      assert.equal(pkg.homepage, "/templates/portfolio/1.0.0/");
      assert.equal(releaseAssetBasePath("portfolio", "1.0.0"), "/templates/portfolio/1.0.0/");
      assert.equal(result.buildReadiness.expectedArtifactPath, "build/index.html");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("prefixes the template's own root-absolute head URLs", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(html.includes("/templates/portfolio/1.0.0/icons/favicon-32x32.png"));
      assert.ok(!/href="\/icons\/favicon-32x32\.png/.test(html), "a bare /icons path survived");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: prefixRootAbsoluteUrls leaves already-prefixed and non-path values alone", () => {
    const base = "/templates/p/1.0.0";
    const first = prefixRootAbsoluteUrls('<link href="/icons/a.png">', base);
    assert.equal(first.html, `<link href="${base}/icons/a.png">`);
    const second = prefixRootAbsoluteUrls(first.html, base);
    assert.equal(second.html, first.html);
    assert.equal(second.rewritten.length, 0);
    const meta = prefixRootAbsoluteUrls('<meta name="theme-color" content="#000000">', base);
    assert.equal(meta.html.includes("#000000"), true);
    assert.equal(meta.rewritten.length, 0);
  });

  it("normalizes BrowserRouter to MemoryRouter with the visitor route", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const main = fs.readFileSync(path.join(adapted, "src/containers/Main.js"), "utf8");
      assert.ok(main.includes("MemoryRouter"), "BrowserRouter was not normalized");
      assert.ok(!main.includes("BrowserRouter"), "BrowserRouter survived");
      assert.ok(main.includes("initialEntries={["), "MemoryRouter has no initialEntries");
      assert.ok(main.includes("__ONEVUE_ROUTE__"), "initialEntries is not driven by the visitor route");
      assert.ok(!/basename=/.test(main), "a stale basename survived");
      assert.ok(main.includes("import { Route, Switch, MemoryRouter } from \"react-router-dom\";"));
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });
});

/* =========================================================================
   Defect 2 — the bundle must read __ONEVUE_DTO__
   ========================================================================= */

describe("Phase 7 — create-react-app DTO rendering contract", () => {
  it("injects a DTO injection point that survives HTML minification", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      // A comment placeholder would be stripped by CRA's minifier; a JSON
      // script block survives and is what the renderer replaces.
      assert.ok(html.includes('<script type="application/json" id="__ONEVUE_DTO__">'));
      assert.ok(fs.existsSync(path.join(adapted, "src/onevue/runtime.js")));
      const generated = fs.readFileSync(path.join(adapted, "src/portfolio.js"), "utf8");
      for (const name of ["settings", "seo", "greeting", "socialMediaLinks", "skills", "degrees", "certifications", "experience", "projectsHeader", "contactPageData"]) {
        assert.ok(new RegExp(`export const ${name}\\b`).test(generated), `generated module lost export ${name}`);
      }
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("does not ship the author's content module when the DTO covers every export", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      assert.equal(
        fs.existsSync(path.join(adapted, "src/onevue/portfolio.base.js")),
        false,
        "the author's content module was retained even though every export maps to the DTO"
      );
      const generated = fs.readFileSync(path.join(adapted, "src/portfolio.js"), "utf8");
      assert.ok(!generated.includes("oneVueBase"), "the generated module still imports the author's values");
      for (const forbidden of [AUTHOR_NAME, "crypticani", "AuthorCorp", "hashnode"]) {
        assert.ok(!generated.includes(forbidden), `author content survived in the generated module: ${forbidden}`);
      }
      // Structural asset names are kept: components resolve them via require().
      assert.ok(generated.includes("projects_image.svg"));
      assert.ok(generated.includes("lpu.jpeg"), "the template's own logo list was lost");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("retains the base module and reports it when an export has no DTO equivalent", async () => {
    const files = craFiles();
    files["src/portfolio.js"] =
      files["src/portfolio.js"].replace(
        "export { settings,",
        "export { publications, settings,"
      ) + "\nconst publications = { title: \"Author Papers\", list: [\"secret paper\"] };\n";
    const { fixture, result, adapted } = await adapt(files);
    try {
      assert.ok(result.findings.some((f) => f.code === "CRA_BASE_MODULE_RETAINED"));
      assert.ok(fs.existsSync(path.join(adapted, "src/onevue/portfolio.base.js")));
      const generated = fs.readFileSync(path.join(adapted, "src/portfolio.js"), "utf8");
      assert.ok(generated.includes("export const publications = oneVueBase.publications;"));
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("renders student data, and never the author's, when the DTO is injected", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const student = {
        meta: { schemaVersion: "1.0.0", canonicalUrl: "https://onevue.me/p/dana" },
        profile: { displayName: "Dana Lee", preferredName: "Dana", initials: "DL", headline: "Systems student", bio: "Builds small tools." },
        education: [{ id: "e1", institution: "State University", degree: "BSc", fieldOfStudy: "CS", startDate: "2022-09-01", endDate: "2025-06-01", currentStatus: "studying", gpa: "3.8" }],
        projects: [{ id: "p1", title: "Campus Map", shortDescription: "A map.", technologies: ["TypeScript"], repoUrl: "https://github.com/dana/map", startDate: "2024-01-01" }],
        skills: [{ id: "s1", name: "Python", category: "Languages", proficiency: "advanced" }],
        credentials: [{ id: "c1", title: "AWS Cloud Practitioner", credentialType: "certification", issuer: "AWS", credentialUrl: "https://aws/verify" }],
        achievements: [],
        media: [],
        contact: { email: "dana@school.edu", socialLinks: [{ id: "l1", platform: "github", url: "https://github.com/dana", category: "code" }] },
      };
      const loaded = loadGeneratedContentModule(adapted, student, { route: "/education" });

      assert.equal(loaded.greeting.title, "Dana Lee");
      assert.equal(loaded.greeting.logo_name, "Dana");
      assert.equal(loaded.seo.title, "Dana Lee's Portfolio");
      assert.equal(loaded.degrees.degrees[0].title, "State University");
      assert.equal(loaded.degrees.degrees[0].duration, "2022-09 - 2025-06");
      assert.equal(loaded.skills.data[0].title, "Languages");
      assert.equal(loaded.skills.data[0].softwareSkills[0].skillName, "Python");
      assert.equal(loaded.certifications.certifications[0].title, "AWS Cloud Practitioner");
      assert.equal(loaded.socialMediaLinks.some((entry) => entry.link === "https://github.com/dana"), true);
      assert.equal(loaded.contactPageData.contactSection.description, "Builds small tools.");
      // The devfolio experience shape is { title, subtitle, sections: [] };
      // components read sections[0].experiences[0], so the container must exist.
      assert.deepEqual(loaded.experience.sections, []);
      assert.equal(typeof loaded.experience.title, "string");

      // The author's personal data must not survive anywhere in the rendered surface.
      const serialized = JSON.stringify(loaded);
      for (const forbidden of [AUTHOR_NAME, "crypticani", "AuthorCorp", "Lovely Professional University", "author.hashnode.dev", "DevOps Engineer"]) {
        assert.ok(!serialized.includes(forbidden), `author content leaked as student data: ${forbidden}`);
      }

      const projects = loadGeneratedProjectsModule(adapted, student);
      assert.equal(projects.data[0].name, "Campus Map");
      assert.equal(projects.data[0].url, "https://github.com/dana/map");
      assert.ok(!JSON.stringify(projects).includes("AuthorRepo"));

      assert.equal(loaded.__route, "/education", "the visitor route did not reach the runtime");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("rewrites the committed author-projects import to the generated module", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const importer = fs.readFileSync(path.join(adapted, "src/containers/Projects.js"), "utf8");
      assert.ok(!importer.includes("projects.json"), "the author project JSON is still imported");
      assert.match(importer, /from "\.\.\/onevue\/projects\.generated"/);
      assert.ok(fs.existsSync(path.join(adapted, "src/onevue/projects.generated.js")));
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: readExportedNames covers both export forms and ignores commented names", () => {
    const names = readExportedNames(
      "const a = 1;\nconst b = 2;\nexport const c = 3;\nexport {\n  a,\n  b as renamed,\n  // d,\n};"
    );
    assert.deepEqual([...new Set(names)].sort(), ["a", "c", "renamed"]);
  });
});

/* =========================================================================
   Defects 3-8 — privacy, security and packaging hygiene
   ========================================================================= */

describe("Phase 7 — create-react-app privacy and hygiene", () => {
  it("removes every analytics and advertising tag", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(!html.includes("googletagmanager.com"), "gtag loader survived");
      assert.ok(!html.includes("dataLayer"), "analytics bootstrap survived");
      assert.ok(!html.includes("AW-825508380"), "advertising id survived");
      assert.ok(html.includes("<meta charset=\"utf-8\"/>"), "legitimate head content was collateral damage");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: stripThirdPartyTracking removes loaders and inline bootstraps only", () => {
    const { html, removed } = stripThirdPartyTracking(
      '<script src="https://www.googletagmanager.com/gtag/js?id=UA-1"></script><script>var app=1</script><script>gtag("config","UA-1")</script>'
    );
    assert.equal(removed.length, 2);
    assert.equal(html.includes("var app=1"), true);
  });

  it("reviews CDN tags instead of deleting them blindly", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(!html.includes("font-awesome/6.4.2"), "redundant CDN stylesheet survived");
      assert.ok(!html.includes("animejs"), "unused CDN library survived");
      assert.ok(!html.includes("canvasjs"), "unused CDN library survived");
      assert.ok(html.includes("code.iconify.design"), "a referenced CDN library was deleted");
      const kept = result.findings.filter((f) => f.code === "CRA_CDN_KEPT");
      assert.ok(kept.some((f) => f.message.includes("iconify")), "the kept dependency was not reported");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: reviewExternalTags classifies tracking, redundant, unused and required", () => {
    const html =
      '<script src="https://www.googletagmanager.com/gtag/js?id=1"></script>' +
      '<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css"/>' +
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/2.0.2/anime.js"></script>' +
      '<script src="https://code.iconify.design/1/1.0.4/iconify.min.js"></script>';
    const reviews = reviewExternalTags(html, 'import "./assets/font-awesome/css/all.css"; const i = "iconify";');
    assert.equal(reviews.find((r) => r.url.includes("googletagmanager")).decision, "remove-tracking");
    assert.equal(reviews.find((r) => r.url.includes("font-awesome")).decision, "remove-redundant");
    assert.equal(reviews.find((r) => r.url.includes("animejs")).decision, "remove-unused");
    assert.equal(reviews.find((r) => r.url.includes("iconify")).decision, "keep-required");
  });

  it("disables production source maps through CRA's own env file", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const env = fs.readFileSync(path.join(adapted, ".env"), "utf8");
      assert.match(env, /^GENERATE_SOURCEMAP=false$/m);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("removes PWA support and the inert service worker output", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      assert.equal(fs.existsSync(path.join(adapted, "public/manifest.json")), false);
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(!html.includes("rel=\"manifest\""), "a manifest link survived");
      const pkg = JSON.parse(fs.readFileSync(path.join(adapted, "package.json"), "utf8"));
      assert.match(pkg.scripts.build, /rm -f build\/service-worker\.js/);
      assert.match(pkg.scripts.build, /precache-manifest/);
      assert.equal(pkg.scripts.deploy, undefined);
      assert.equal(pkg.scripts.predeploy, undefined);
      assert.ok(pkg.scripts.build.startsWith("react-scripts build"), "the original build command was replaced");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("repairs malformed and duplicate head metadata", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(!/name="Aniket's Portfolio"/.test(html), "the invalid meta name survived");
      assert.equal((html.match(/rel="manifest"/g) || []).length, 0);
      assert.ok(html.includes("<meta name=\"viewport\""), "valid metadata was collateral damage");
      assert.ok(html.includes("<meta charset=\"utf-8\""), "charset was collateral damage");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: repairHeadMetadata keeps page keys and drops person keys", () => {
    const { html, fixes } = repairHeadMetadata(
      '<meta charset="utf-8"/><meta name="viewport" content="width=x"/>' +
      '<meta name="author" content="Someone"/><meta name="A B\'s Portfolio" content="x"/>' +
      '<meta property="og:title" content="Someone"/><title>Someone\'s Portfolio</title>'
    );
    assert.ok(html.includes('name="viewport"'), "page-level metadata must survive");
    assert.ok(html.includes('charset="utf-8"'), "charset must survive");
    assert.ok(!html.includes('name="author"'), "person-level metadata must not survive");
    assert.ok(!html.includes("og:title"), "author open-graph must not survive");
    assert.ok(!html.includes("A B's Portfolio"), "the invalid meta name survived");
    assert.ok(html.includes("<title></title>"), "the title insertion point is gone");
    assert.equal(fixes.length, 3, "one fix per repaired category");
  });
});

/* =========================================================================
   Unchecked content access
   ========================================================================= */

describe("Phase 7 — create-react-app content access hardening", () => {
  it("guards the first-experience and mailto reads that unmount the app", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const seo = fs.readFileSync(path.join(adapted, "src/components/seoHeader/SeoHeader.js"), "utf8");
      assert.ok(!/experience\.sections\[0\]\.experiences\[0\]\./.test(seo), "an unchecked first-experience read survived");
      assert.ok(seo.includes("|| {}"), "no guard was inserted");
      assert.ok(
        result.findings.some((f) => f.code === "CRA_CONTENT_ACCESS_HARDENED"),
        "the hardening was not reported"
      );

      // The guarded expression must still resolve the author's value when the
      // data IS present, and must not throw when it is absent.
      const withData = { profile: { displayName: "Dana" }, contact: { socialLinks: [] }, education: [], projects: [], skills: [], credentials: [] };
      const evaluated = new Function(
        "experience",
        "return ((((experience.sections || [])[0] || {}).experiences || [])[0] || {}).title;"
      );
      assert.equal(evaluated({ sections: [{ experiences: [{ title: "Intern" }] }] }), "Intern");
      assert.equal(evaluated({ sections: [] }), undefined);
      assert.equal(evaluated({}), undefined);

      const mailEval = (links) =>
        new Function(
          "socialMediaLinks",
          'return (((socialMediaLinks.find((media) => media.link.startsWith("mailto")) || {}).link) || "").substring("mailto:".length);'
        )(links);
      assert.equal(mailEval([{ link: "mailto:dana@x.edu" }]), "dana@x.edu");
      assert.equal(mailEval([]), "");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: hardenContentAccess leaves unrelated code untouched", () => {
    const untouched = hardenContentAccess('export const x = [1,2].map((n) => n + 1);');
    assert.equal(untouched.changed, false);
    assert.equal(untouched.fixes.length, 0);
  });
});

/* =========================================================================
   Image names a require() context can resolve
   ========================================================================= */

describe("Phase 7 — create-react-app image name safety", () => {
  it("never emits a logo the template does not ship", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const shipped = new Set(fs.readdirSync(path.join(adapted, "src/assets/images")));
      const student = {
        meta: { schemaVersion: "1.0.0" },
        profile: { displayName: "Zia" },
        // Nothing here matches any logo the template ships.
        education: [{ id: "e1", institution: "Unknown Institute", degree: "BA", currentStatus: "completed" }],
        credentials: [{ id: "c1", title: "Some Course", issuer: "Nobody", credentialUrl: "" }],
        projects: [], skills: [], achievements: [], media: [],
        contact: { socialLinks: [] },
      };
      const loaded = loadGeneratedContentModule(adapted, student, { route: "/" });

      // CertificationCard dereferences require() unguarded, so an unknown or
      // empty logo name throws and unmounts the page.
      for (const certificate of loaded.certifications.certifications) {
        assert.ok(shipped.has(certificate.logo_path), `unresolvable certification logo: '${certificate.logo_path}'`);
      }
      assert.equal(loaded.certifications.certifications.length, 1);
      for (const degree of loaded.degrees.degrees) {
        if (degree.logo_path !== "") {
          assert.ok(shipped.has(degree.logo_path), `unresolvable degree logo: '${degree.logo_path}'`);
        }
      }
      assert.ok(shipped.has(loaded.projectsHeader.avatar_image_path));
      assert.ok(shipped.has(loaded.contactPageData.contactSection.profile_image_path));
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("drops certifications when the template ships no images at all", async () => {
    const files = craFiles();
    for (const key of Object.keys(files)) {
      if (key.startsWith("src/assets/images/")) delete files[key];
    }
    const { fixture, result, adapted } = await adapt(files);
    try {
      const student = {
        meta: { schemaVersion: "1.0.0" },
        profile: { displayName: "Zia" },
        education: [], projects: [], skills: [], achievements: [], media: [],
        credentials: [{ id: "c1", title: "Course", issuer: "Nobody" }],
        contact: { socialLinks: [] },
      };
      const loaded = loadGeneratedContentModule(adapted, student, {});
      assert.deepEqual(loaded.certifications.certifications, []);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: sanitizeAssets replaces an unshipped avatar name", () => {
    const sanitized = sanitizeAssets(
      { isSplash: false, projectsAvatar: "gone.svg", contactAvatar: "avatar.svg", blogAvatar: "blogs_image.svg", experienceHeader: "experience.svg", experienceSubtitle: "s", skillImages: [], degreeLogos: [], certificationLogos: [] },
      ["avatar.svg", "projects_image.svg", "education.svg"]
    );
    assert.equal(sanitized.projectsAvatar, "projects_image.svg");
    assert.equal(sanitized.contactAvatar, "avatar.svg");
  });
});

/* =========================================================================
   Strategy selection and fail-closed behaviour
   ========================================================================= */

describe("Phase 7 — create-react-app strategy selection", () => {
  it("auto-selects the CRA strategy for a devfolio-shaped CRA app", async () => {
    const { fixture, result } = await adapt(craFiles());
    try {
      assert.ok(result.findings.some((f) => f.code === "CRA_DEVFOLIO_AUTO_SELECTED"));
      assert.ok(result.buildReadiness.readyToBuild);
      assert.equal(result.buildReadiness.framework, "create-react-app");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("falls back to static-standard when the CRA app is not devfolio-shaped", async () => {
    const files = craFiles();
    delete files["src/portfolio.js"];
    const { fixture, result } = await adapt(files);
    try {
      assert.ok(result.findings.some((f) => f.code === "CRA_AUTO_SELECTED"));
      assert.equal(result.findings.some((f) => f.code === "CRA_DEVFOLIO_AUTO_SELECTED"), false);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("fails closed when no BrowserRouter can be normalized", async () => {
    const files = craFiles();
    files["src/containers/Main.js"] = 'import React from "react";\nexport default function Main() { return <div/>; }';
    const { fixture, result } = await adapt(files);
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.match(result.error || "", /BrowserRouter/);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("does not emit the dead generic adapter or manifest for CRA templates", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      assert.equal(fs.existsSync(path.join(adapted, "src/adapter/profile-adapter.ts")), false);
      assert.equal(fs.existsSync(path.join(adapted, "src/manifest.ts")), false);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("unit: detection needs react-scripts and the content signature", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cra-detect-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/other.js"), "export const greeting = 1;", "utf8");
      const detection = detectCraDevfolio(dir, { dependencies: { "react-scripts": "3.2.0" } });
      assert.equal(detection.detected, false);
      assert.ok(detection.reasons.join(" ").includes("greeting"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unit: generateContentModuleSource is valid syntax and covers unknown exports", () => {
    const source = generateContentModuleSource(
      ["greeting", "seo", "experience", "mysteryExport"],
      { isSplash: false, projectsAvatar: "p.svg", contactAvatar: "c.svg", blogAvatar: "b.svg", skillImages: ["CloudInfraImg"], degreeLogos: [["state university", "su.png"]], certificationLogos: [] }
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics.length, 0, JSON.stringify(compiled.diagnostics.map((d) => d.messageText)));
    assert.ok(source.includes("export const mysteryExport = oneVueBase.mysteryExport;"));
    assert.ok(source.includes("import * as oneVueBase"), "unknown exports require the base import");
  });

  it("unit: generateContentModuleSource needs no base import for a fully mapped surface", () => {
    const source = generateContentModuleSource(
      ["greeting", "seo", "settings", "socialMediaLinks", "skills", "degrees", "certifications", "experience", "projectsHeader", "contactPageData"],
      { isSplash: false, projectsAvatar: "p.svg", contactAvatar: "c.svg", blogAvatar: "b.svg", skillImages: [], degreeLogos: [], certificationLogos: [] }
    );
    assert.equal(source.includes("oneVueBase"), false);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics.length, 0);
  });

  it("unit: extractContentAssets keeps structural file names only", () => {
    const assets = extractContentAssets(
      'const settings = { isSplash: true };\n' +
      'const degrees = { degrees: [ { title: "State University", logo_path: "su.png" } ] };\n' +
      'const certifications = { certifications: [ { title: "Oracle", logo_path: "oracle.png" } ] };\n' +
      'const skills = { data: [ { fileName: "CloudInfraImg", softwareSkills: [] } ] };\n' +
      'const projectsHeader = { avatar_image_path: "projects_image.svg" };\n' +
      'const contactPageData = { contactSection: { profile_image_path: "avatar.svg" }, blogSection: { avatar_image_path: "blogs_image.svg" } };'
    );
    assert.equal(assets.isSplash, true);
    assert.deepEqual(assets.degreeLogos, [["state university", "su.png"]]);
    assert.deepEqual(assets.certificationLogos, [["oracle", "oracle.png"]]);
    assert.deepEqual(assets.skillImages, ["CloudInfraImg"]);
    assert.equal(assets.projectsAvatar, "projects_image.svg");
    assert.equal(assets.contactAvatar, "avatar.svg");
    assert.equal(assets.blogAvatar, "blogs_image.svg");
    // Titles are kept, lower-cased, only to match a student's institution to a
    // logo the template already ships; no other personal value is carried.
    assert.equal(JSON.stringify(assets).includes("state university"), true);
    assert.equal(JSON.stringify(assets).includes("Oracle Cloud"), false);
    assert.equal(JSON.stringify(assets).includes("secret"), false);
  });
});

/* =========================================================================
   Author-only datasets the DTO cannot represent
   ========================================================================= */

describe("Phase 7 — create-react-app author data removal", () => {
  it("empties the committed contribution history instead of shipping the author's", async () => {
    const files = craFiles();
    const { fixture, result, adapted } = await adapt(files);
    try {
      const issues = fs.readFileSync(path.join(adapted, "src/containers/issues/Issues.js"), "utf8");
      assert.ok(!issues.includes("issues.json"), "the author's issue history is still imported");
      assert.ok(fs.existsSync(path.join(adapted, "src/onevue/issues.generated.js")));
      assert.ok(fs.existsSync(path.join(adapted, "src/onevue/pull_requests.generated.js")));
      assert.ok(result.findings.some((f) => f.code === "CRA_CONTRIBUTIONS_REMOVED"));
      const generated = fs.readFileSync(path.join(adapted, "src/onevue/issues.generated.js"), "utf8");
      assert.match(generated, /data:\s*\[\s*\]/);
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("removes author-identifying head metadata owned by the visitor renderer", async () => {
    const { fixture, result, adapted } = await adapt(craFiles());
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      assert.ok(!html.includes("og:title"), "author og:title survived");
      assert.ok(!html.includes("og:url"), "author og:url survived");
      assert.ok(!html.includes("crypticani"), "author identity survived in the head");
      assert.ok(!/itemprop="name"/.test(html), "author itemprop survived");
      assert.ok(!html.includes("Aniket"), "author name survived in the head");
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });

  it("never emits a double slash in a delivered asset path", async () => {
    const files = craFiles({
      "public/index.html":
        '<html><head><link rel="icon" href="/icons//android-chrome-192x192.png"><link rel="apple-touch-icon" href="/icons///apple.png"></head><body></body></html>',
    });
    const { fixture, result, adapted } = await adapt(files);
    try {
      const html = fs.readFileSync(path.join(adapted, "public/index.html"), "utf8");
      const urls = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
      assert.ok(urls.length >= 2, "no asset URLs were found to assert on");
      for (const url of urls) {
        assert.ok(!url.includes("//"), `delivery boundary would refuse '${url}' (empty path segment)`);
        assert.ok(url.startsWith("/templates/portfolio/1.0.0/"), `'${url}' is outside the release base path`);
      }
    } finally {
      await result.cleanup?.();
      fixture.cleanup();
    }
  });
});

/* =========================================================================
   Module loader used by the DTO rendering test
   ========================================================================= */

function loadModuleWithDto(adaptedDir, relative, dto, website) {
  const document = {
    getElementById(id) {
      if (id !== "__ONEVUE_DTO__") return null;
      return { textContent: JSON.stringify({ dto, website }) };
    },
  };
  const win = {};
  const cache = new Map();

  function load(target) {
    const full = path.join(adaptedDir, target);
    const cached = cache.get(full);
    if (cached) return cached;

    const placeholder = { exports: {} };
    cache.set(full, placeholder);

    const source = fs.readFileSync(full, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;

    const loaded = new Module(full, null);
    loaded.filename = full;
    loaded.paths = Module._nodeModulePaths(path.dirname(full));
    const requireLocal = (request) => {
      if (!request.startsWith(".")) return require(request);
      const resolved = path.resolve(path.dirname(full), request.replace(/^\.\//, ""));
      const relativeTarget = path.relative(adaptedDir, resolved).replace(/\\/g, "/");
      const child = load(
        /\.[cm]?js$/.test(relativeTarget) ? relativeTarget : `${relativeTarget}.js`
      );
      return child.exports;
    };

    const originalDocument = global.document;
    const originalWindow = global.window;
    global.document = document;
    global.window = win;
    try {
      loaded._compile(compiled, full);
    } finally {
      global.document = originalDocument;
      global.window = originalWindow;
    }
    cache.set(full, loaded);
    return loaded;
  }

  const loaded = load(relative);
  return { exports: loaded.exports, window: win };
}

function loadGeneratedContentModule(adaptedDir, dto, website) {
  const { exports, window: win } = loadModuleWithDto(adaptedDir, "src/portfolio.js", dto, website);
  return { ...exports, __route: win.__ONEVUE_ROUTE__ };
}

function loadGeneratedProjectsModule(adaptedDir, dto) {
  const { exports } = loadModuleWithDto(adaptedDir, "src/onevue/projects.generated.js", dto, {});
  return exports.default;
}
