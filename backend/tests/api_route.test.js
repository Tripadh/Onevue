/**
 * API Route Integration Test for PUT and GET /api/student/profile
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const envFile = fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8');
const match = envFile.match(/MONGODB_URI="([^"]+)"/);
const uri = match[1];
const jwtMatch = envFile.match(/JWT_SECRET="([^"]+)"/);
const jwtSecret = jwtMatch ? jwtMatch[1] : 'fallback_secret';

// Set environment variables before any application modules are required
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

const ts = require(path.join(projectRoot, 'node_modules', 'typescript'));

// Register .ts extension loader on the fly for TypeScript models and route
require.extensions['.ts'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  module._compile(compiled.outputText, filename);
};

const mongoose = require(path.join(projectRoot, 'node_modules', 'mongoose'));
const jwt = require(path.join(projectRoot, 'node_modules', 'jsonwebtoken'));

let User, StudentProfile, routeModule;

describe('Student Profile API Route Integration Tests', () => {
  let testUser;
  let testToken;

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, 'models', 'User.ts')).default;
    StudentProfile = require(path.join(projectRoot, 'models', 'StudentProfile.ts')).default;
    routeModule = require(path.join(projectRoot, 'app', 'api', 'student', 'profile', 'route.ts'));

    const timestamp = Date.now();
    testUser = await User.create({
      name: `Route Test User ${timestamp}`,
      email: `route_test_${timestamp}@example.com`,
      password: 'hash',
      identity: 'student',
    });
    testToken = jwt.sign({ id: testUser._id.toString(), email: testUser.email }, jwtSecret);
  });

  after(async () => {
    if (testUser) {
      await StudentProfile.deleteMany({ userId: testUser._id });
      await User.deleteOne({ _id: testUser._id });
    }
    await mongoose.disconnect();
  });

  function mockRequest(method, body = null, tokenOverride = undefined) {
    const activeToken = tokenOverride !== undefined ? tokenOverride : testToken;
    const headers = new Map();
    if (activeToken) headers.set('authorization', `Bearer ${activeToken}`);
    headers.set('content-type', 'application/json');

    return {
      method,
      headers: {
        get: (name) => headers.get(name.toLowerCase()) || null,
      },
      json: async () => body,
    };
  }

  test('GET without token returns 401', async () => {
    const req = mockRequest('GET', null, null);
    const res = await routeModule.GET(req);
    assert.equal(res.status, 401);
  });

  test('GET with valid token returns 200 and baseline profile', async () => {
    const req = mockRequest('GET');
    const res = await routeModule.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.profile);
    assert.equal(data.user.id.toString(), testUser._id.toString());
  });

  test('PUT with multiple resumes returns 400', async () => {
    const req = mockRequest('PUT', {
      resumes: [{ fileName: 'r1.pdf' }, { fileName: 'r2.pdf' }],
    });
    const res = await routeModule.PUT(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('Multiple resumes are not permitted'));
  });

  test('PUT with non-PDF resume contentType returns 400', async () => {
    const req = mockRequest('PUT', {
      resume: {
        fileName: 'resume.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
    const res = await routeModule.PUT(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('Only PDF resumes are supported'));
  });

  test('PUT with unauthorized userId attempt returns 403', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const req = mockRequest('PUT', {
      userId: fakeId,
      headline: 'Hijacked Profile',
    });
    const res = await routeModule.PUT(req);
    assert.equal(res.status, 403);
  });

  test('PUT with invalid education URL returns 400', async () => {
    const req = mockRequest('PUT', {
      education: [
        {
          institution: 'Harvard',
          degree: 'B.A.',
          website: 'not-a-valid-url',
        },
      ],
    });
    const res = await routeModule.PUT(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes('Invalid website URL'));
  });

  test('PUT with valid multi-module payload returns 200 and updates canonical data', async () => {
    const req = mockRequest('PUT', {
      headline: 'Full-Stack & Systems Engineer',
      preferredName: 'Alex',
      education: [
        {
          institution: 'Stanford University',
          degree: 'B.S. Computer Science',
          currentStatus: 'studying',
          gpa: '3.94',
        },
      ],
      skills: [
        {
          name: 'TypeScript',
          category: 'Programming Languages',
          proficiency: 'Expert',
        },
      ],
      resume: {
        fileName: 'Alex_Chen_Official_2026.pdf',
        fileSize: 154000,
        contentType: 'application/pdf',
        targetRole: 'Full Stack Engineer',
      },
    });
    const res = await routeModule.PUT(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.profile.headline, 'Full-Stack & Systems Engineer');
    assert.equal(data.profile.preferredName, 'Alex');
    assert.equal(data.profile.education.length, 1);
    assert.equal(data.profile.education[0].institution, 'Stanford University');
    assert.equal(data.profile.resume.fileName, 'Alex_Chen_Official_2026.pdf');
  });
});
