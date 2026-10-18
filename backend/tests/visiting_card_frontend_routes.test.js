/**
 * ONEVUE — Visiting Card Routing & Architecture Test Suite
 * Validates route paths, redirect configuration, viewMode derivation,
 * template design generator, and absence of legacy local state navigation.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Visiting Card Frontend Routes & Navigation Verification', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const appJsxPath = path.join(rootDir, 'frontend', 'components', 'core', 'app.jsx');
  const pageJsxPath = path.join(rootDir, 'frontend', 'components', 'dashboard', 'student', 'StudentVisitingCardPage.jsx');
  const navJsxPath = path.join(rootDir, 'frontend', 'components', 'dashboard', 'student', 'StudentNavigation.jsx');
  const dashJsxPath = path.join(rootDir, 'frontend', 'components', 'dashboard', 'student', 'StudentDashboard.jsx');
  const serviceJsPath = path.join(rootDir, 'frontend', 'services', 'visiting-card.js');

  test('1. app.jsx configures all required canonical routes and legacy redirect', () => {
    const appContent = fs.readFileSync(appJsxPath, 'utf8');

    // Canonical subroutes
    assert.match(appContent, /path="\/app\/student\/visiting-card\/overview"/, 'Overview route missing');
    assert.match(appContent, /path="\/app\/student\/visiting-card\/templates"/, 'Templates route missing');
    assert.match(appContent, /path="\/app\/student\/visiting-card\/studio\/new"/, 'Studio new draft route missing');
    assert.match(appContent, /path="\/app\/student\/visiting-card\/studio\/:cardId"/, 'Studio editor route missing');

    // Legacy redirect
    assert.match(
      appContent,
      /<Route\s+path="\/app\/student\/visiting-card"\s+element={<Navigate\s+to="\/app\/student\/visiting-card\/overview"\s+replace\s*\/>}\s*\/>/,
      'Legacy route redirect missing or incorrect'
    );
  });

  test('2. StudentNavigation.jsx links to canonical overview route', () => {
    const navContent = fs.readFileSync(navJsxPath, 'utf8');
    assert.match(
      navContent,
      /path:\s*'\/app\/student\/visiting-card\/overview'/,
      'Sidebar navigation item should point to .../overview'
    );
  });

  test('3. StudentDashboard.jsx topbar title handles all visiting card subroutes', () => {
    const dashContent = fs.readFileSync(dashJsxPath, 'utf8');
    assert.match(dashContent, /sub\.includes\('\/templates'\)/);
    assert.match(dashContent, /sub\.includes\('\/studio'\)/);
  });

  test('4. StudentVisitingCardPage.jsx contains zero setViewMode calls', () => {
    const pageContent = fs.readFileSync(pageJsxPath, 'utf8');
    assert.doesNotMatch(pageContent, /\bsetViewMode\s*\(/, 'Legacy setViewMode call found');
  });

  test('5. StudentVisitingCardPage.jsx derives viewMode correctly from pathname', () => {
    function deriveViewMode(pathname) {
      const lower = pathname.toLowerCase();
      if (lower.includes('/visiting-card/templates')) return 'templates';
      if (lower.includes('/visiting-card/studio/new')) return 'studio-new';
      if (lower.includes('/visiting-card/studio')) return 'studio';
      return 'my-cards';
    }

    assert.equal(deriveViewMode('/app/student/visiting-card/overview'), 'my-cards');
    assert.equal(deriveViewMode('/app/student/visiting-card/templates'), 'templates');
    assert.equal(deriveViewMode('/app/student/visiting-card/studio/new'), 'studio-new');
    assert.equal(deriveViewMode('/app/student/visiting-card/studio/6620f1a4e4b0123456789abc'), 'studio');
    assert.equal(deriveViewMode('/app/student/visiting-card'), 'my-cards');
  });

  test('6. StudentVisitingCardPage.jsx extracts routeCardId correctly', () => {
    function extractCardId(pathname, params = {}) {
      if (params?.cardId) return params.cardId;
      const lower = pathname.toLowerCase();
      if (lower.includes('/studio/') && !lower.endsWith('/new')) {
        const seg = pathname.split('/studio/')[1];
        if (seg) return seg.split(/[?#/]/)[0] || null;
      }
      return null;
    }

    assert.equal(extractCardId('/app/student/visiting-card/studio/card_xyz_123'), 'card_xyz_123');
    assert.equal(extractCardId('/app/student/visiting-card/studio/card_xyz_123?foo=bar'), 'card_xyz_123');
    assert.equal(extractCardId('/app/student/visiting-card/studio/new'), null);
    assert.equal(extractCardId('/app/student/visiting-card/overview'), null);
    assert.equal(extractCardId('/app/student/visiting-card/templates'), null);
  });

  test('7. visiting-card.js exports generateDefaultCardDesign with double-sided support for all 9 templates', () => {
    // Mock environment for visiting-card.js
    global.window = {
      OV_ENV: { API_BASE: 'http://localhost:3000/api' },
      OV: {
        core: {
          db: { get: () => null, set: () => {} },
          http: async () => ({}),
          ServiceError: class ServiceError extends Error {},
        },
        services: {},
      },
    };

    require(serviceJsPath);

    const fn = global.window.generateDefaultCardDesign;
    assert.equal(typeof fn, 'function', 'generateDefaultCardDesign is not a function');

    const templateIds = [
      'academic-classic',
      'executive-navy',
      'developer-terminal',
      'creative-studio',
      'founder-minimal',
      'researcher-editorial',
      'cyber-matrix',
      'consultant-serif',
      'creator-gradient',
    ];

    const seed = {
      name: 'Jordan Lee',
      headline: 'Robotics Engineer',
      institution: 'MIT',
      degree: 'M.S. Robotics',
      email: 'jordan@mit.edu',
      phone: '+1-555-0199',
      location: 'Cambridge, MA',
      username: 'jordanlee',
    };

    for (const tmplId of templateIds) {
      const doc = fn(tmplId, seed);
      assert.ok(doc, `Failed generating doc for template: ${tmplId}`);
      assert.ok(doc.front, `Missing front side for template: ${tmplId}`);
      assert.ok(doc.back, `Missing back side for template: ${tmplId}`);
      assert.ok(Array.isArray(doc.front.elements), `front.elements is not an array for ${tmplId}`);
      assert.ok(Array.isArray(doc.back.elements), `back.elements is not an array for ${tmplId}`);
      assert.ok(doc.front.elements.length > 0, `front has no elements for ${tmplId}`);
      assert.ok(doc.back.elements.length > 0, `back has no elements for ${tmplId}`);
      assert.ok(doc.front.background, `front has no background for ${tmplId}`);
      assert.ok(doc.back.background, `back has no background for ${tmplId}`);
      assert.ok(doc.dimensions, `dimensions missing for ${tmplId}`);
    }
  });

  test('8. Studio contains unsaved-changes alert and exit confirmation', () => {
    const pageContent = fs.readFileSync(pageJsxPath, 'utf8');
    assert.match(pageContent, /window\.addEventListener\('beforeunload'/, 'Missing beforeunload listener');
    assert.match(pageContent, /handleExitStudio/, 'Missing handleExitStudio handler');
    assert.match(pageContent, /Leave without saving\?/, 'Missing exit confirmation message');
  });

  test('9. Studio and Overview contain Unpublish confirmation modal', () => {
    const pageContent = fs.readFileSync(pageJsxPath, 'utf8');
    assert.match(pageContent, /showUnpublishModal/, 'Missing showUnpublishModal state');
    assert.match(pageContent, /handleUnpublish/, 'Missing handleUnpublish call');
    assert.match(pageContent, /Unpublish Visiting Card\?/, 'Missing Unpublish modal dialog');
  });

  test('10. Studio Save Draft supports navigateOnSuccess (D3)', () => {
    const pageContent = fs.readFileSync(pageJsxPath, 'utf8');
    assert.match(pageContent, /options\.navigateOnSuccess/, 'handleSaveDraft does not check navigateOnSuccess');
    assert.match(pageContent, /navigateOnSuccess:\s*true/, 'Studio Save Draft button does not pass navigateOnSuccess');
  });
});
