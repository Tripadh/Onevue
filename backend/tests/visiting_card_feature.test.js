/**
 * ONEVUE — Visiting Card Studio Feature Integration & Security Test Suite
 * Tests card loading, draft saving, element validation, template switching,
 * asset uploads, QR generation, safe publishing, unpublishing, and public endpoint isolation.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const { loadEnvConfig } = require(path.join(projectRoot, 'node_modules', '@next', 'env'));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || 'fallback_secret';
if (!uri) {
  throw new Error('MONGODB_URI is not set. Define it in backend/.env.local.');
}

// Configure test environment
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;
process.env.PROFILE_PHOTO_STORAGE = 'local';

const ts = require(path.join(projectRoot, 'node_modules', 'typescript'));

// Register .ts transpile loader on the fly
require.extensions['.ts'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  });
  module._compile(compiled.outputText, filename);
};

const mongoose = require(path.join(projectRoot, 'node_modules', 'mongoose'));
const jwt = require(path.join(projectRoot, 'node_modules', 'jsonwebtoken'));

let User, VisitingCard, StudentProfile;
let cardRoute, publishRoute, unpublishRoute, uploadRoute, qrRoute, publicCardRoute;

describe('OneVue Visiting Card Studio Feature Integration Tests', () => {
  let testUser1;
  let testUser2;
  let testToken1;
  let testToken2;

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, 'models', 'User.ts')).default;
    VisitingCard = require(path.join(projectRoot, 'models', 'VisitingCard.ts')).default;
    await VisitingCard.collection.dropIndex("userId_1").catch(() => {});
    StudentProfile = require(path.join(projectRoot, 'models', 'StudentProfile.ts')).default;

    cardRoute = require(path.join(projectRoot, 'app', 'api', 'student', 'card', 'route.ts'));
    publishRoute = require(path.join(projectRoot, 'app', 'api', 'student', 'card', 'publish', 'route.ts'));
    unpublishRoute = require(path.join(projectRoot, 'app', 'api', 'student', 'card', 'unpublish', 'route.ts'));
    uploadRoute = require(path.join(projectRoot, 'app', 'api', 'student', 'card', 'upload', 'route.ts'));
    qrRoute = require(path.join(projectRoot, 'app', 'api', 'student', 'card', 'qr', 'route.ts'));
    publicCardRoute = require(path.join(projectRoot, 'app', 'api', 'public', 'card', '[username]', 'route.ts'));

    const tsNow = Date.now();

    testUser1 = await User.create({
      name: `Card Student ${tsNow}`,
      email: `card_student_${tsNow}@example.com`,
      password: 'hashed_password',
      identity: 'student',
      username: `cardstudent_${tsNow}`,
    });
    testToken1 = jwt.sign({ id: testUser1._id.toString(), email: testUser1.email }, jwtSecret);

    // Seed sample student profile for testUser1
    await StudentProfile.create({
      userId: testUser1._id,
      headline: 'CS & Robotics Scholar',
      education: [
        {
          institution: 'Stanford University',
          degree: 'B.S. Computer Science',
          gradYear: '2026',
        },
      ],
      contacts: {
        phone: '+1-555-0199',
        github: 'stanford-scholar',
      },
    });

    testUser2 = await User.create({
      name: `Other Student ${tsNow}`,
      email: `other_student_${tsNow}@example.com`,
      password: 'hashed_password',
      identity: 'student',
      username: `otherstudent_${tsNow}`,
    });
    testToken2 = jwt.sign({ id: testUser2._id.toString(), email: testUser2.email }, jwtSecret);
  });

  after(async () => {
    if (testUser1) {
      await VisitingCard.deleteMany({ userId: testUser1._id });
      await StudentProfile.deleteMany({ userId: testUser1._id });
      await User.deleteOne({ _id: testUser1._id });
    }
    if (testUser2) {
      await VisitingCard.deleteMany({ userId: testUser2._id });
      await User.deleteOne({ _id: testUser2._id });
    }
    await mongoose.disconnect();
  });

  function mockRequest(method, body = null, tokenOverride = undefined, formDataOverride = null) {
    const activeToken = tokenOverride !== undefined ? tokenOverride : testToken1;
    const headers = new Map();
    if (activeToken) headers.set('authorization', `Bearer ${activeToken}`);
    if (body !== null) headers.set('content-type', 'application/json');

    return {
      method,
      headers: {
        get: (name) => headers.get(name.toLowerCase()) || null,
      },
      json: async () => body,
      formData: async () => formDataOverride,
    };
  }

  /* ---------------- 1. Authentication & Card Initialization ---------------- */
  test('1.1 GET /api/student/card without token returns 401', async () => {
    const req = mockRequest('GET', null, null);
    const res = await cardRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test('1.2 GET /api/student/card initializes default card seeded from student profile', async () => {
    const req = mockRequest('GET');
    const res = await cardRoute.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.card);
    assert.equal(data.card.userId.toString(), testUser1._id.toString());
    assert.equal(data.card.selectedTemplateId, 'academic-classic');
    assert.equal(data.card.publicationStatus, 'draft');

    // Verify elements seeded from StudentProfile
    const elements = data.card.designDocument.elements;
    assert.ok(elements.length > 0);
    const nameEl = elements.find(el => el.id === 'el_name');
    assert.ok(nameEl);
    assert.equal(nameEl.content, testUser1.name);

    const titleEl = elements.find(el => el.id === 'el_title');
    assert.ok(titleEl);
    assert.equal(titleEl.content, 'CS & Robotics Scholar');
  });

  /* ---------------- 2. Saving Drafts & Validation ---------------- */
  test('2.1 PUT /api/student/card updates draft design without publishing', async () => {
    const updatedElements = [
      {
        id: 'el_custom_title',
        type: 'text',
        x: 80,
        y: 80,
        width: 400,
        height: 50,
        content: 'Customized Card Title',
        fontSize: 32,
      },
    ];

    const req = mockRequest('PUT', {
      selectedTemplateId: 'minimal',
      designName: 'My Polished Card',
      designDocument: {
        dimensions: { width: 1050, height: 600, unit: 'px' },
        background: { type: 'solid', color: '#FFFFFF' },
        elements: updatedElements,
      },
      visibilitySettings: { showEmail: true, showPhone: true },
    });

    const res = await cardRoute.PUT(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.card.selectedTemplateId, 'minimal');
    assert.equal(data.card.designName, 'My Polished Card');
    // Ensure draft save does NOT automatically publish
    assert.equal(data.card.publicationStatus, 'draft');
    assert.equal(data.card.publishedSnapshot, null);
  });

  test('2.2 PUT /api/student/card rejects unapproved template ID', async () => {
    const req = mockRequest('PUT', {
      selectedTemplateId: 'fake-invalid-template-999',
    });
    const res = await cardRoute.PUT(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /invalid template id/i);
  });

  test('2.3 PUT /api/student/card rejects malformed elements without coordinates', async () => {
    const req = mockRequest('PUT', {
      designDocument: {
        elements: [
          { id: 'el_broken', type: 'text' }, // missing x, y
        ],
      },
    });
    const res = await cardRoute.PUT(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /numeric/i);
  });

  /* ---------------- 3. Card Publishing & Public Endpoint ---------------- */
  test('3.1 Before publishing, GET /api/public/card/[username] returns 404', async () => {
    const req = { method: 'GET' };
    const res = await publicCardRoute.GET(req, {
      params: Promise.resolve({ username: testUser1.username }),
    });
    assert.equal(res.status, 404);
  });

  test('3.2 POST /api/student/card/publish creates frozen snapshot and publishes card', async () => {
    const req = mockRequest('POST');
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.card.publicationStatus, 'published');
    assert.ok(data.card.publishedSnapshot);
    assert.ok(data.card.publishedAt);
  });

  test('3.3 After publishing, GET /api/public/card/[username] returns 200 with snapshot', async () => {
    const req = { method: 'GET' };
    const res = await publicCardRoute.GET(req, {
      params: Promise.resolve({ username: testUser1.username }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.card.design);
    assert.equal(data.card.username, testUser1.username);
    assert.equal(data.card.user.name, testUser1.name);
  });

  test('3.4 Editing draft does NOT modify active public snapshot until republished', async () => {
    // Modify draft to add a new element
    const modifiedElements = [
      {
        id: 'el_draft_only',
        type: 'text',
        x: 10,
        y: 10,
        width: 200,
        height: 30,
        content: 'DRAFT ONLY UNPUBLISHED CONTENT',
      },
    ];

    const putReq = mockRequest('PUT', {
      designDocument: {
        dimensions: { width: 1050, height: 600, unit: 'px' },
        background: { type: 'solid', color: '#111111' },
        elements: modifiedElements,
      },
    });
    const putRes = await cardRoute.PUT(putReq);
    assert.equal(putRes.status, 200);

    // Verify public endpoint still serves previous published snapshot!
    const pubReq = { method: 'GET' };
    const pubRes = await publicCardRoute.GET(pubReq, {
      params: Promise.resolve({ username: testUser1.username }),
    });
    assert.equal(pubRes.status, 200);
    const pubData = await pubRes.json();
    const hasDraftElement = pubData.card.design.elements.some(x => x.id === 'el_draft_only');
    assert.equal(hasDraftElement, false);
  });

  /* ---------------- 4. Unpublishing Card ---------------- */
  test('4.1 POST /api/student/card/unpublish sets status to unpublished', async () => {
    const req = mockRequest('POST');
    const res = await unpublishRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.card.publicationStatus, 'unpublished');

    // Public endpoint immediately returns 404
    const pubReq = { method: 'GET' };
    const pubRes = await publicCardRoute.GET(pubReq, {
      params: Promise.resolve({ username: testUser1.username }),
    });
    assert.equal(pubRes.status, 404);
  });

  /* ---------------- 5. Asset Uploads & QR Code Generation ---------------- */
  test('5.1 POST /api/student/card/upload accepts valid PNG and attaches reference', async () => {
    // Valid PNG magic bytes
    const pngBuf = Buffer.alloc(100);
    pngBuf[0] = 0x89;
    pngBuf[1] = 0x50;
    pngBuf[2] = 0x4e;
    pngBuf[3] = 0x47;
    pngBuf[4] = 0x0d;
    pngBuf[5] = 0x0a;
    pngBuf[6] = 0x1a;
    pngBuf[7] = 0x0a;

    const mockFormData = {
      get: (k) => (k === 'file' ? {
        name: 'stanford_crest.png',
        size: pngBuf.length,
        type: 'image/png',
        arrayBuffer: async () => pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength),
      } : null),
    };

    const req = mockRequest('POST', null, testToken1, mockFormData);
    const res = await uploadRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.asset.publicUrl);
    assert.equal(data.asset.name, 'stanford_crest.png');
  });

  test('5.2 GET /api/student/card/qr generates valid SVG QR code', async () => {
    const req = {
      method: 'GET',
      url: 'http://localhost:3000/api/student/card/qr?url=https://onevue.id/card/test&format=svg',
    };
    const res = await qrRoute.GET(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    const svgText = await res.text();
    assert.match(svgText, /<svg/i);
    assert.match(svgText, /<\/svg>/i);
  });

  /* ---------------- 6. Multi-Card Management & Double-Sided Studio ---------------- */
  let newCardId;
  let duplicatedCardId;

  test('6.1 POST /api/student/card creates a new card with selected template', async () => {
    const req = mockRequest('POST', {
      action: 'create',
      templateId: 'developer',
      designName: 'My Terminal Tech Card',
    });
    const res = await cardRoute.POST(req);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.card);
    assert.equal(data.card.selectedTemplateId, 'developer');
    assert.equal(data.card.designName, 'My Terminal Tech Card');
    assert.equal(data.card.isDefault, false);
    assert.ok(data.card.designDocument.front);
    assert.ok(data.card.designDocument.back);
    newCardId = data.card._id.toString();
  });

  test('6.2 POST /api/student/card duplicates an existing card', async () => {
    const req = mockRequest('POST', {
      action: 'duplicate',
      sourceCardId: newCardId,
    });
    const res = await cardRoute.POST(req);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.card);
    assert.match(data.card.designName, /\(Copy\)/);
    assert.equal(data.card.selectedTemplateId, 'developer');
    assert.equal(data.card.publicationStatus, 'draft');
    duplicatedCardId = data.card._id.toString();
  });

  test('6.3 GET /api/student/card returns list of user cards', async () => {
    const req = mockRequest('GET');
    const res = await cardRoute.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.cards));
    assert.ok(data.cards.length >= 3); // initial + created + duplicated
  });

  test('6.4 PUT /api/student/card persists double-sided design with front and back elements', async () => {
    const doubleSidedDoc = {
      dimensions: { width: 1050, height: 600, orientation: 'horizontal', unit: 'px' },
      front: {
        background: { type: 'solid', color: '#0D1117' },
        elements: [
          { id: 'f_title', type: 'text', x: 50, y: 50, width: 300, height: 40, content: 'Front Header' },
        ],
      },
      back: {
        background: { type: 'solid', color: '#010409' },
        elements: [
          { id: 'b_title', type: 'text', x: 50, y: 50, width: 300, height: 40, content: 'Back QR & Monogram' },
        ],
      },
    };

    const req = mockRequest('PUT', {
      cardId: newCardId,
      designDocument: doubleSidedDoc,
    });
    const res = await cardRoute.PUT(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.card.designDocument.front.elements[0].content, 'Front Header');
    assert.equal(data.card.designDocument.back.elements[0].content, 'Back QR & Monogram');
  });

  test('6.5 POST /api/student/card/publish publishes specific cardId with both sides frozen', async () => {
    const req = mockRequest('POST', { cardId: newCardId });
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.card.publicationStatus, 'published');
    assert.equal(data.card.isDefault, true);
    assert.ok(data.card.publishedSnapshot.front);
    assert.ok(data.card.publishedSnapshot.back);
    assert.equal(data.card.publishedSnapshot.front.elements[0].content, 'Front Header');
    assert.equal(data.card.publishedSnapshot.back.elements[0].content, 'Back QR & Monogram');
  });

  test('6.6 DELETE /api/student/card deletes duplicate card with ownership check', async () => {
    const req = {
      ...mockRequest('DELETE'),
      url: `http://localhost:3000/api/student/card?cardId=${duplicatedCardId}`,
    };
    const res = await cardRoute.DELETE(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify it is gone from user's cards
    const checkCard = await VisitingCard.findById(duplicatedCardId);
    assert.equal(checkCard, null);
  });

  test('6.7 Template catalog contains all 9 product categories and vertical layouts', () => {
    const { VISITING_CARD_TEMPLATES } = require(path.join(projectRoot, 'lib', 'templates', 'visiting-card-templates.ts'));
    const categories = new Set(Object.values(VISITING_CARD_TEMPLATES).map(t => t.category));
    const requiredCategories = [
      'Professional',
      'Minimal',
      'Creative',
      'Corporate',
      'Student',
      'Freelancer',
      'Developer',
      'Creator',
      'Business',
    ];

    for (const cat of requiredCategories) {
      assert.ok(categories.has(cat), `Missing required category: ${cat}`);
    }

    const verticalTemplates = Object.values(VISITING_CARD_TEMPLATES).filter(t => t.orientation === 'vertical');
    assert.ok(verticalTemplates.length >= 2, 'Should have at least 2 vertical card templates');
  });

  /* ---------------- 7. D1 (Max 3 Published Limit) & D4 (Card ID Hardening) ---------------- */
  test('7.1 PUT /api/student/card with invalid or nonexistent cardId returns 400/404', async () => {
    // Invalid format
    const reqInvalid = mockRequest('PUT', { cardId: 'bad_id_123', designName: 'Test' });
    const resInvalid = await cardRoute.PUT(reqInvalid);
    assert.equal(resInvalid.status, 400);

    // Nonexistent ObjectId
    const fakeId = new mongoose.Types.ObjectId().toString();
    const reqNotFound = mockRequest('PUT', { cardId: fakeId, designName: 'Test' });
    const resNotFound = await cardRoute.PUT(reqNotFound);
    assert.equal(resNotFound.status, 404);
  });

  test('7.2 POST /api/student/card/publish and unpublish with nonexistent cardId return 404', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const pubReq = mockRequest('POST', { cardId: fakeId });
    const pubRes = await publishRoute.POST(pubReq);
    assert.equal(pubRes.status, 404);

    const unpubReq = mockRequest('POST', { cardId: fakeId });
    const unpubRes = await unpublishRoute.POST(unpubReq);
    assert.equal(unpubRes.status, 404);
  });

  test('7.3 Enforces maximum of 3 published cards per user (D1)', async () => {
    // Currently testUser1 has 1 published card (newCardId from test 6.5; initialCard was unpublished in 4.1)
    // Create card 3 and card 4
    const c3Res = await cardRoute.POST(mockRequest('POST', { action: 'create', templateId: 'minimal', designName: 'Card 3' }));
    assert.equal(c3Res.status, 201);
    const card3 = (await c3Res.json()).card;

    const c4Res = await cardRoute.POST(mockRequest('POST', { action: 'create', templateId: 'creative', designName: 'Card 4' }));
    assert.equal(c4Res.status, 201);
    const card4 = (await c4Res.json()).card;

    const c5Res = await cardRoute.POST(mockRequest('POST', { action: 'create', templateId: 'corporate-vanguard', designName: 'Card 5' }));
    assert.equal(c5Res.status, 201);
    const card5 = (await c5Res.json()).card;

    // Publish card 3 (published count = 2)
    const pub3Res = await publishRoute.POST(mockRequest('POST', { cardId: card3._id.toString() }));
    assert.equal(pub3Res.status, 200);

    // Publish card 4 (published count = 3, reaching the limit)
    const pub4Res = await publishRoute.POST(mockRequest('POST', { cardId: card4._id.toString() }));
    assert.equal(pub4Res.status, 200);

    // Attempt to publish card 5 (exceeds limit of 3 -> MUST return 400)
    const pub5Res = await publishRoute.POST(mockRequest('POST', { cardId: card5._id.toString() }));
    assert.equal(pub5Res.status, 400);
    const pub5Data = await pub5Res.json();
    assert.equal(pub5Data.code, 'PUBLISHED_LIMIT_REACHED');

    // Clean up created cards
    await VisitingCard.deleteMany({ _id: { $in: [card3._id, card4._id, card5._id] } });
  });
});
