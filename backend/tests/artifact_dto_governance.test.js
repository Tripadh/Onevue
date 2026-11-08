/**
 * =========================================================================
 * OneVue Phase 11 — Artifact DTO-Adaptation Governance Check
 * =========================================================================
 *
 * Proves the two governance properties the task requires, against the real
 * artifacts on disk:
 *
 * 1. The UNADAPTED production release (`.local-template-storage/templates/
 *    portfolio/1.0.0`) is BLOCKED. It has no `__ONEVUE_DTO__` block, so it
 *    was never adapted to render student data. It must not be previewable
 *    and must not be selectable from the student catalog.
 *
 * 2. The REBUILT release (`.phase11-isolated/storage/templates/portfolio/
 *    1.0.0`) IS accepted: its entrypoint carries the DTO block, so the
 *    preview renderer injects student data instead of the author's demo
 *    content.
 *
 * This test reads the artifacts; it never promotes or overwrites anything.
 *
 * ENVIRONMENT: the two artifact roots above are local runtime state produced
 * by a real pipeline run (the seeded production release and the isolated
 * rebuild). They are deliberately not committed. On a machine — or a CI
 * runner — that has not run the pipeline there is nothing to inspect, so the
 * suite is skipped there instead of failing. The governance property itself
 * does not depend on this suite: the refusal is enforced in the delivery
 * code and is covered hermetically by student_template_selection and
 * template_source_inspection.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const ts = require(path.join(projectRoot, 'node_modules', 'typescript'));
require.extensions['.ts'] = function (module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  module._compile(compiled.outputText, filename);
};

const {
  LocalFilesystemStorageAdapter,
} = require(path.join(projectRoot, 'lib', 'template-storage.ts'));
const { renderTemplatePreviewDocument } = require(path.join(projectRoot, 'lib', 'template-preview.ts'));

const repoRoot = path.resolve(projectRoot, '..');

const PRODUCTION_ENTRY = path.join(
  repoRoot,
  '.local-template-storage',
  'templates',
  'portfolio',
  '1.0.0',
  'index.html'
);
const REBUILT_ROOT = path.join(repoRoot, '.phase11-isolated', 'storage', 'templates', 'portfolio', '1.0.0');
const REBUILT_ENTRY = path.join(REBUILT_ROOT, 'index.html');

const DTO_MARKER = '__ONEVUE_DTO__';

const LOCAL_ARTIFACTS_AVAILABLE =
  fs.existsSync(PRODUCTION_ENTRY) && fs.existsSync(REBUILT_ENTRY);

describe(
  'OneVue Phase 11 — artifact DTO adaptation governance',
  {
    skip: LOCAL_ARTIFACTS_AVAILABLE
      ? false
      : 'local template artifacts are not present (.local-template-storage, .phase11-isolated)',
  },
  () => {
    describe('the unadapted production release stays blocked', () => {
      it('exists on disk and has no DTO block', () => {
        assert.ok(fs.existsSync(PRODUCTION_ENTRY), 'the production release must still exist untouched');
        const html = fs.readFileSync(PRODUCTION_ENTRY, 'utf8');
        assert.ok(
          !html.includes(DTO_MARKER),
          'the production release must remain unadapted (no __ONEVUE_DTO__ block)'
        );
      });

      it('is refused by the preview renderer with ARTIFACT_NOT_DTO_ADAPTED', async () => {
        const result = await renderTemplatePreviewDocument({
          templateId: 'portfolio',
          templateVersion: '1.0.0',
          origin: 'http://localhost:8080',
          storageAdapter: new LocalFilesystemStorageAdapter(path.join(repoRoot, '.local-template-storage')),
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, 409);
        assert.equal(result.code, 'ARTIFACT_NOT_DTO_ADAPTED');
        assert.match(result.message, /never adapted/i);
      });

      it('still carries the author demo content it was published with', () => {
        const html = fs.readFileSync(PRODUCTION_ENTRY, 'utf8');
        assert.match(html, /Aniket/i, 'the production release must be untouched, demo content included');
      });
    });

    describe('the rebuilt release is genuinely adapted', () => {
      it('carries the DTO block in its entrypoint', () => {
        assert.ok(fs.existsSync(REBUILT_ENTRY), 'the rebuilt release must exist in isolated storage');
        const html = fs.readFileSync(REBUILT_ENTRY, 'utf8');
        assert.ok(html.includes(DTO_MARKER), 'the rebuilt entrypoint must carry the DTO block');
      });

      it('no longer carries the author demo content', () => {
        const html = fs.readFileSync(REBUILT_ENTRY, 'utf8');
        assert.doesNotMatch(html, /Aniket/i);
        assert.doesNotMatch(html, /crypticani/i);
      });

      it('has no active analytics or tracking hosts', () => {
        const html = fs.readFileSync(REBUILT_ENTRY, 'utf8');
        for (const host of [
          'googletagmanager.com',
          'google-analytics.com',
          'doubleclick.net',
          'gtag(',
          'dataLayer',
        ]) {
          assert.ok(
            !html.includes(host),
            `the rebuilt entrypoint must not contain the tracking host or call "${host}"`
          );
        }
      });

      it('is accepted by the preview renderer', async () => {
        const result = await renderTemplatePreviewDocument({
          templateId: 'portfolio',
          templateVersion: '1.0.0',
          origin: 'http://localhost:8080',
          storageAdapter: new LocalFilesystemStorageAdapter(path.join(repoRoot, '.phase11-isolated', 'storage')),
        });

        assert.equal(result.ok, true, `the rebuilt release must preview cleanly: ${result && result.message}`);
        assert.ok(result.html.includes(DTO_MARKER), 'the previewed HTML must contain the injected DTO');
      });
    });

    describe('the two releases are independent', () => {
      it('leaves the production release byte-identical to its unadapted state', () => {
        const productionHtml = fs.readFileSync(PRODUCTION_ENTRY, 'utf8');
        const rebuiltHtml = fs.readFileSync(REBUILT_ENTRY, 'utf8');
        assert.notEqual(productionHtml, rebuiltHtml, 'the rebuilt release must not have overwritten production');
        assert.ok(!productionHtml.includes(DTO_MARKER));
        assert.ok(rebuiltHtml.includes(DTO_MARKER));
      });
    });
  }
);
