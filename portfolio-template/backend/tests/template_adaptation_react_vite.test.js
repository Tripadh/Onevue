/**
 * =========================================================================
 * OneVue Phase 6.2 — react-vite adaptation strategy tests
 * =========================================================================
 *
 * Fixture-based, offline tests for the reusable React + Vite strategy:
 * base rewrite, DTO placeholder/runtime, router normalization, EmailJS
 * rejection, declarative content mapping, idempotency and fail-closed cases.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  detectReactVite,
  rewriteViteBuildScript,
  normalizeBrowserRouter,
} = require("../lib/template-adapters/react-vite.ts");

function createFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-rv-fixture-"));
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

function reactViteFiles(overrides = {}) {
  const files = {
    "package.json": JSON.stringify(
      {
        name: "react-vite-fixture",
        private: true,
        scripts: { build: "vite build" },
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", "react-router-dom": "^7.0.0" },
        devDependencies: { "@vitejs/plugin-react": "^6.0.0", vite: "^8.0.0" },
      },
      null,
      2
    ),
    "vite.config.js": 'import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };\n',
    "index.html":
      '<!doctype html><html><head><title>Fixture</title></head><body><div id="root"></div><script type="module" src="/src/index.jsx"></script></body></html>',
    "src/index.jsx": 'import React from "react";\nimport App from "./app/App";\n',
    "src/app/App.jsx":
      'import { BrowserRouter as Router, Route, Routes } from "react-router-dom";\n' +
      "export default function App() {\n" +
      "  return (\n" +
      '    <Router basename={import.meta.env.BASE_URL.replace(/\\/$/, "")}>\n' +
      "      <Routes><Route path=\"/\" element={<div>Home</div>} /></Routes>\n" +
      "    </Router>\n" +
      "  );\n" +
      "}\n",
    "src/pages/home.jsx": 'import React from "react";\nexport default function Home() { return <div>John Doe</div>; }\n',
    "onevue.adapter.json": JSON.stringify({
      version: 1,
      targetModule: "src/onevue/content.generated.js",
      exports: {
        meta: {
          title: { dto: "profile.displayName" },
          description: { dto: "profile.headline", default: "" },
        },
        skills: { dto: "skills" },
        contact: { dto: "contact", default: { email: "", socialLinks: [] } },
      },
    }),
  };
  return { ...files, ...overrides };
}

async function adapt(fixtureFiles, options = {}) {
  const fixture = createFixture(fixtureFiles);
  try {
    const result = await adaptTemplateSource({
      sourceDir: fixture.dir,
      templateId: options.templateId || "react-vite-fixture",
      templateVersion: options.templateVersion || "1.0.0",
      ...(options.strategy ? { strategy: options.strategy } : {}),
    });
    return { result, fixture };
  } catch (error) {
    fixture.cleanup();
    throw error;
  }
}

describe("Phase 6.2 — react-vite adaptation strategy", () => {
  it("adapts a React + Vite template: base, DTO runtime, router, content map", async () => {
    const { result, fixture } = await adapt(reactViteFiles(), { strategy: "react-vite" });
    try {
      assert.equal(result.status, "ADAPTED", result.error);
      assert.equal(result.buildReadiness.readyToBuild, true);
      assert.equal(
        result.buildReadiness.buildScript,
        "vite build --base=/templates/react-vite-fixture/1.0.0/"
      );

      const adapted = result.adaptedDir;
      const pkg = JSON.parse(fs.readFileSync(path.join(adapted, "package.json"), "utf8"));
      assert.equal(pkg.scripts.build, "vite build --base=/templates/react-vite-fixture/1.0.0/");

      const indexHtml = fs.readFileSync(path.join(adapted, "index.html"), "utf8");
      assert.match(indexHtml, /<!--\s*<script type="application\/json" id="__ONEVUE_DTO__">\{\}<\/script>\s*-->/);
      assert.ok(indexHtml.includes('src="/src/onevue/runtime.js"'));

      const runtime = fs.readFileSync(path.join(adapted, "src/onevue/runtime.js"), "utf8");
      assert.ok(runtime.includes("@onevue-generated"));
      assert.ok(runtime.includes("getOneVueProfile"));
      assert.ok(runtime.includes("DEFAULT_PROFILE"));

      const app = fs.readFileSync(path.join(adapted, "src/app/App.jsx"), "utf8");
      assert.ok(app.includes("MemoryRouter as Router"));
      assert.ok(!app.includes("BrowserRouter"));
      assert.ok(!app.includes("basename"));

      const contentModule = fs.readFileSync(path.join(adapted, "src/onevue/content.generated.js"), "utf8");
      assert.ok(contentModule.includes('pick("profile.displayName"'));
      assert.ok(contentModule.includes("export const meta"));
      assert.ok(contentModule.includes("export const skills"));
      assert.ok(contentModule.includes('pick("profile.headline", "")'));

      const codes = result.findings.map((finding) => finding.code);
      assert.ok(codes.includes("VITE_BASE_APPLIED"));
      assert.ok(codes.includes("RUNTIME_GENERATED"));
      assert.ok(codes.includes("DTO_PLACEHOLDER_ADDED"));
      assert.ok(codes.includes("ROUTER_NORMALIZED"));
      assert.ok(codes.includes("CONTENT_MAP_GENERATED"));
      assert.ok(codes.includes("MANUAL_CONTENT_WIRING_REQUIRED"));
      assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);

      assert.ok(result.createdFiles.some((file) => file.relativePath === "src/onevue/runtime.js"));
      assert.ok(result.modifiedFiles.some((file) => file.relativePath === "package.json"));
      assert.ok(result.modifiedFiles.some((file) => file.relativePath === "src/app/App.jsx"));

      // Source immutability: the original fixture is never modified.
      const originalApp = fs.readFileSync(path.join(fixture.dir, "src/app/App.jsx"), "utf8");
      assert.ok(originalApp.includes("BrowserRouter"));
      const originalPkg = JSON.parse(fs.readFileSync(path.join(fixture.dir, "package.json"), "utf8"));
      assert.equal(originalPkg.scripts.build, "vite build");
    } finally {
      await result.cleanup();
      fixture.cleanup();
    }
  });

  it("auto-selects react-vite when no strategy is requested (React + Vite detected)", async () => {
    const { result, fixture } = await adapt(reactViteFiles());
    try {
      assert.equal(result.status, "ADAPTED", result.error);
      assert.ok(result.findings.some((finding) => finding.code === "REACT_VITE_AUTO_SELECTED"));
      assert.match(result.buildReadiness.buildScript, /--base=\/templates\/react-vite-fixture\/1\.0\.0\//);
    } finally {
      await result.cleanup();
      fixture.cleanup();
    }
  });

  it("is idempotent when re-adapting an already adapted template", async () => {
    const first = await adapt(reactViteFiles(), { strategy: "react-vite" });
    let secondFixture;
    try {
      // Copy the adapted output and adapt it again.
      const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-rv-fixture-"));
      fs.cpSync(first.result.adaptedDir, secondDir, { recursive: true });
      secondFixture = { dir: secondDir, cleanup: () => fs.rmSync(secondDir, { recursive: true, force: true }) };

      const second = await adaptTemplateSource({
        sourceDir: secondDir,
        templateId: "react-vite-fixture",
        templateVersion: "1.0.0",
        strategy: "react-vite",
      });
      try {
        assert.equal(second.status, "COMPATIBLE", second.error);
        assert.equal(second.createdFiles.length, 0);
        assert.equal(second.modifiedFiles.length, 0);
        assert.equal(
          second.buildReadiness.buildScript,
          "vite build --base=/templates/react-vite-fixture/1.0.0/",
          "the base flag must not be duplicated"
        );
        const codes = second.findings.map((finding) => finding.code);
        assert.ok(codes.includes("VITE_BASE_PRESENT"));
        assert.ok(codes.includes("DTO_PLACEHOLDER_PRESENT"));
        assert.ok(codes.includes("RUNTIME_PRESENT"));
        assert.ok(codes.includes("CONTENT_MAP_PRESENT"));
      } finally {
        await second.cleanup();
      }
    } finally {
      await first.result.cleanup();
      first.fixture.cleanup();
      if (secondFixture) secondFixture.cleanup();
    }
  });

  it("fails closed when EmailJS is integrated", async () => {
    const files = reactViteFiles({
      "package.json": JSON.stringify(
        {
          name: "emailjs-fixture",
          scripts: { build: "vite build" },
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            "@emailjs/browser": "^4.0.0",
          },
          devDependencies: { "@vitejs/plugin-react": "^6.0.0", vite: "^8.0.0" },
        },
        null,
        2
      ),
      "src/pages/contact.jsx":
        'import emailjs from "@emailjs/browser";\nexport const send = () => emailjs.send("s", "t", {}, "u");\n',
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.equal(result.adaptedDir, undefined);
      const finding = result.findings.find((entry) => entry.code === "EMAILJS_REQUIRES_REMOVAL");
      assert.ok(finding, "EmailJS must be reported");
      assert.equal(finding.severity, "error");
      assert.match(finding.message, /mailto|link-based/i);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed on unsafe BrowserRouter usage (alias/tag mismatch)", async () => {
    const files = reactViteFiles({
      "src/app/App.jsx":
        'import { BrowserRouter as Router } from "react-router-dom";\n' +
        'export default function App() { return <BrowserRouter><div /></BrowserRouter>; }\n',
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.equal(result.adaptedDir, undefined);
      assert.ok(result.findings.some((finding) => finding.code === "ROUTER_TRANSFORM_UNSAFE"));
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a Vite project that is not React when react-vite is requested", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "plain-vite", scripts: { build: "vite build" }, devDependencies: { vite: "^8.0.0" } }),
      "vite.config.js": "export default {};\n",
      "index.html": "<!doctype html><html><head></head><body></body></html>",
    };
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "REACT_VITE_NOT_DETECTED"));
    } finally {
      fixture.cleanup();
    }

    // Without an explicit strategy, a non-React Vite project keeps the legacy strategy.
    const auto = await adapt(files);
    try {
      assert.notEqual(auto.result.status, "INCOMPATIBLE", auto.result.error);
      const codes = auto.result.findings.map((finding) => finding.code);
      assert.ok(!codes.includes("REACT_VITE_AUTO_SELECTED"));
    } finally {
      await auto.result.cleanup();
      auto.fixture.cleanup();
    }
  });

  it("rejects a custom Vite outDir (artifact contract requires dist/index.html)", async () => {
    const files = reactViteFiles({
      "vite.config.js": 'export default { build: { outDir: "public-build" } };\n',
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "CUSTOM_OUT_DIR_UNSUPPORTED"));
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects a build script that does not end with 'vite build'", async () => {
    const files = reactViteFiles({
      "package.json": JSON.stringify(
        {
          name: "chained-build",
          scripts: { build: "vite build && cp dist/index.html dist/404.html" },
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: { "@vitejs/plugin-react": "^6.0.0", vite: "^8.0.0" },
        },
        null,
        2
      ),
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "UNSAFE_VITE_BUILD_SCRIPT"));
    } finally {
      fixture.cleanup();
    }
  });

  it("warns but adapts when no declarative content map is provided", async () => {
    const files = reactViteFiles();
    delete files["onevue.adapter.json"];
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "ADAPTED", result.error);
      const finding = result.findings.find((entry) => entry.code === "CONTENT_MAPPING_REQUIRED");
      assert.ok(finding);
      assert.equal(finding.severity, "warning");
      assert.ok(!fs.existsSync(path.join(result.adaptedDir, "src/onevue/content.generated.js")));
    } finally {
      await result.cleanup();
      fixture.cleanup();
    }
  });

  it("handles templates without BrowserRouter", async () => {
    const files = reactViteFiles({
      "src/app/App.jsx": 'import React from "react";\nexport default function App() { return <main>Portfolio</main>; }\n',
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "ADAPTED", result.error);
      assert.ok(result.findings.some((finding) => finding.code === "ROUTER_NONE"));
    } finally {
      await result.cleanup();
      fixture.cleanup();
    }
  });

  it("refuses to overwrite a foreign runtime module", async () => {
    const files = reactViteFiles({
      "src/onevue/runtime.js": "export function myCustomAdapter() { return {}; }\n",
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "RUNTIME_CONFLICT"));
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects an invalid declarative content map", async () => {
    const files = reactViteFiles({
      "onevue.adapter.json": JSON.stringify({
        version: 1,
        targetModule: "../outside.js",
        exports: { meta: { dto: "profile.displayName" } },
      }),
    });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "CONTENT_MAP_INVALID"));
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when index.html cannot accept the DTO placeholder", async () => {
    const files = reactViteFiles({ "index.html": "<!doctype html><body><div id=\"root\"></div></body>" });
    const { result, fixture } = await adapt(files, { strategy: "react-vite" });
    try {
      assert.equal(result.status, "INCOMPATIBLE");
      assert.ok(result.findings.some((finding) => finding.code === "DTO_PLACEHOLDER_UNSAFE"));
    } finally {
      fixture.cleanup();
    }
  });

  it("unit: detection requires both Vite and React evidence", () => {
    const viteOnly = createFixture({
      "package.json": JSON.stringify({ name: "vite-only", devDependencies: { vite: "^8.0.0" } }),
      "vite.config.js": "export default {};\n",
    });
    try {
      assert.equal(detectReactVite(viteOnly.dir, { devDependencies: { vite: "^8.0.0" } }).detected, false);
    } finally {
      viteOnly.cleanup();
    }
    const reactOnly = createFixture({
      "package.json": JSON.stringify({ name: "react-only", dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }),
    });
    try {
      assert.equal(
        detectReactVite(reactOnly.dir, {
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        }).detected,
        false
      );
    } finally {
      reactOnly.cleanup();
    }
  });

  it("unit: base rewrite replaces an existing --base instead of duplicating it", () => {
    const first = rewriteViteBuildScript("vite build", "/templates/x/1.0.0/");
    assert.equal(first.ok, true);
    assert.equal(first.script, "vite build --base=/templates/x/1.0.0/");

    const second = rewriteViteBuildScript(first.script, "/templates/x/1.0.0/");
    assert.equal(second.script, first.script);

    const chained = rewriteViteBuildScript("tsc && vite build", "/templates/x/1.0.0/");
    assert.equal(chained.ok, true);
    assert.equal(chained.script, "tsc && vite build --base=/templates/x/1.0.0/");

    assert.equal(rewriteViteBuildScript("webpack build", "/templates/x/1.0.0/").ok, false);
  });

  it("unit: router normalization keeps aliases and never touches unrelated code", () => {
    const aliased =
      'import { BrowserRouter as Router, Link } from "react-router-dom";\n' +
      'export const x = "BrowserRouter";\n' +
      'export default () => <Router basename="/app"><Link to="/">x</Link></Router>;\n';
    const result = normalizeBrowserRouter(aliased);
    assert.equal(result.error, undefined);
    assert.ok(result.content.includes("MemoryRouter as Router"));
    assert.ok(result.content.includes('<Router >') || result.content.includes("<Router>"));
    assert.ok(!result.content.includes("basename"));
    assert.ok(result.content.includes('export const x = "BrowserRouter"'), "string literals stay untouched");

    const unaliased =
      'import { BrowserRouter } from "react-router-dom";\nexport default () => <BrowserRouter><div /></BrowserRouter>;\n';
    const renamed = normalizeBrowserRouter(unaliased);
    assert.ok(renamed.content.includes("import { MemoryRouter }"));
    assert.ok(renamed.content.includes("<MemoryRouter>"));
    assert.ok(renamed.content.includes("</MemoryRouter>"));
  });
});
