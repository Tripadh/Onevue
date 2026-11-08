/**
 * =========================================================================
 * OneVue Phase 5.13 — Seed Local Template Artifact Into Backend Storage
 * =========================================================================
 *
 * Usage:
 *   node backend/scripts/seed_local_template_artifact.js \
 *     --source <built-artifact-dir> \
 *     --template-id <id> \
 *     --template-version <version> \
 *     [--commit <sha>] \
 *     [--dto-version 1.0.0]
 *
 * Purpose
 * -------
 * Publishes an ALREADY BUILT template artifact into the backend artifact
 * storage so the public visitor path delivers it from that storage instead
 * of an independently copied fixture inside the portfolio application.
 *
 * The script performs NO build and NO lifecycle execution. It only:
 *   1. copies the existing build output into a staging directory,
 *   2. runs the platform's own verifyAndPackageArtifact() to produce the
 *      immutable release manifest (SHA-256 per file), and
 *   3. runs the platform's own LocalFilesystemStorageAdapter.storeArtifact()
 *      to write the release into <storageRoot>/templates/<id>/<version>/.
 *
 * Storage is immutable: re-running the script for an existing version
 * reports ALREADY_STORED and never overwrites it.
 *
 * The storage root is shared with the portfolio visitor bridge through the
 * ONEVUE_TEMPLATE_STORAGE_ROOT environment variable.
 */

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

// The backend has no node_modules directory installed in this environment, so
// the TypeScript sources are loaded through the same transpile hook the
// backend test suite uses.
function registerTypeScriptLoader() {
  if (require.extensions[".ts"]) {
    return;
  }
  let ts;
  try {
    ts = require("typescript");
  } catch {
    try {
      ts = require(path.resolve(projectRoot, "node_modules", "typescript"));
    } catch {
      ts = require(path.resolve(projectRoot, "..", "portfolio", "node_modules", "typescript"));
    }
  }
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

registerTypeScriptLoader();

const { seedLocalTemplateArtifact } = require(path.join(
  projectRoot,
  "lib",
  "template-local-delivery.ts"
));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const source = args.source;
  const templateId = args["template-id"];
  const templateVersion = args["template-version"];

  if (!source || !templateId || !templateVersion) {
    console.error(
      "Usage: node backend/scripts/seed_local_template_artifact.js --source <dir> --template-id <id> --template-version <version>"
    );
    process.exit(1);
  }

  const result = await seedLocalTemplateArtifact({
    sourceArtifactDir: path.resolve(source),
    templateId: String(templateId),
    templateVersion: String(templateVersion),
    sourceCommitSha: String(args.commit || "local-development-seed"),
    supportedDtoVersions: [String(args["dto-version"] || "1.0.0")],
  });

  console.log("outcome          :", result.outcome);
  console.log("template         :", `${result.templateId}@${result.templateVersion}`);
  console.log("artifacts root   :", result.artifactsRoot);
  if (result.artifactDir) {
    console.log("artifact dir     :", result.artifactDir);
  }
  if (result.storageLocation) {
    console.log("storage location :", result.storageLocation);
  }
  if (result.manifestSha256) {
    console.log("manifestSha256   :", result.manifestSha256);
  }
  if (result.fileCount !== undefined) {
    console.log("files / bytes    :", `${result.fileCount} files, ${result.totalBytes} bytes`);
  }
  if (result.error) {
    console.error("error            :", result.error);
  }

  process.exit(result.outcome === "SEEDED" || result.outcome === "ALREADY_STORED" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
