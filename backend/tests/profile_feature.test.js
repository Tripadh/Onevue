/**
 * ONEVUE — Production Profile & Profile Photo Feature Test Suite
 * Covers Authentication, Storage Abstraction, Security, Magic Bytes,
 * Path Traversal Prevention, Photo Replacement/Removal, and Password Update.
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
const bcrypt = require(path.join(projectRoot, 'node_modules', 'bcryptjs'));

let User, profileRoute, photoRoute, photoKeyRoute, changePasswordRoute;
let validationModule, localStorageModule, r2StorageModule, storageIndexModule;

describe('OneVue Account Profile & Profile Photo Feature Tests', () => {
  let testUser1;
  let testUser2;
  let testToken1;
  let testToken2;

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, 'models', 'User.ts')).default;
    profileRoute = require(path.join(projectRoot, 'app', 'api', 'profile', 'route.ts'));
    photoRoute = require(path.join(projectRoot, 'app', 'api', 'profile', 'photo', 'route.ts'));
    photoKeyRoute = require(path.join(projectRoot, 'app', 'api', 'profile', 'photo', '[key]', 'route.ts'));
    changePasswordRoute = require(path.join(projectRoot, 'app', 'api', 'profile', 'change-password', 'route.ts'));

    validationModule = require(path.join(projectRoot, 'lib', 'storage', 'validation.ts'));
    localStorageModule = require(path.join(projectRoot, 'lib', 'storage', 'local-storage.ts'));
    r2StorageModule = require(path.join(projectRoot, 'lib', 'storage', 'r2-storage.ts'));
    storageIndexModule = require(path.join(projectRoot, 'lib', 'storage', 'index.ts'));

    const tsNow = Date.now();
    const hashedPassword = await bcrypt.hash('CurrentSecret123!', 10);

    testUser1 = await User.create({
      name: `Profile User One ${tsNow}`,
      email: `profile_user1_${tsNow}@example.com`,
      password: hashedPassword,
      identity: 'student',
      username: `student_${tsNow}`,
    });
    testToken1 = jwt.sign({ id: testUser1._id.toString(), email: testUser1.email }, jwtSecret);

    testUser2 = await User.create({
      name: `Profile User Two ${tsNow}`,
      email: `profile_user2_${tsNow}@example.com`,
      password: hashedPassword,
      identity: 'professional',
      username: `claimedhandle_${tsNow}`,
    });
    testToken2 = jwt.sign({ id: testUser2._id.toString(), email: testUser2.email }, jwtSecret);
  });

  after(async () => {
    if (testUser1) {
      if (testUser1.profilePhotoKey) {
        const storage = storageIndexModule.getProfilePhotoStorage();
        try { await storage.delete(testUser1.profilePhotoKey); } catch (_) {}
      }
      await User.deleteOne({ _id: testUser1._id });
    }
    if (testUser2) {
      if (testUser2.profilePhotoKey) {
        const storage = storageIndexModule.getProfilePhotoStorage();
        try { await storage.delete(testUser2.profilePhotoKey); } catch (_) {}
      }
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

  // Helper to construct sample valid image buffers
  function createValidJpegBuffer() {
    // Starts with FF D8 FF
    const buf = Buffer.alloc(100);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    buf[3] = 0xe0;
    return buf;
  }

  function createValidPngBuffer() {
    // Starts with 89 50 4E 47 0D 0A 1A 0A
    const buf = Buffer.alloc(100);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    buf[4] = 0x0d;
    buf[5] = 0x0a;
    buf[6] = 0x1a;
    buf[7] = 0x0a;
    return buf;
  }

  function createValidWebpBuffer() {
    // RIFF .... WEBP
    const buf = Buffer.alloc(100);
    buf.write('RIFF', 0, 4, 'ascii');
    buf.write('WEBP', 8, 4, 'ascii');
    return buf;
  }

  /* ---------------- 1. Authentication & Profile Retrieval ---------------- */
  test('1.1 GET /api/profile without token returns 401', async () => {
    const req = mockRequest('GET', null, null);
    const res = await profileRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test('1.2 GET /api/profile with invalid token returns 401', async () => {
    const req = mockRequest('GET', null, 'malformed_invalid_token');
    const res = await profileRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test('1.3 GET /api/profile with valid token returns safe profile data', async () => {
    const req = mockRequest('GET');
    const res = await profileRoute.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.user);
    assert.equal(data.user.id, testUser1._id.toString());
    assert.equal(data.user.email, testUser1.email);
    assert.equal(data.user.name, testUser1.name);
    assert.equal(data.user.isEmailVerified, true);
    // Sensitive data must never be exposed
    assert.equal(data.user.password, undefined);
    assert.equal(data.user.__v, undefined);
  });

  /* ---------------- 2. Updating Profile (PATCH /api/profile) ---------------- */
  test('2.1 PATCH /api/profile updates allowed fields (name, bio, location, username)', async () => {
    const req = mockRequest('PATCH', {
      name: 'Maya Updated Lin',
      bio: 'Aspiring AI and Robotics Researcher.',
      location: 'San Francisco, CA',
      username: `mayalin_${Date.now()}`,
    });
    const res = await profileRoute.PATCH(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.name, 'Maya Updated Lin');
    assert.equal(data.user.bio, 'Aspiring AI and Robotics Researcher.');
    assert.equal(data.user.location, 'San Francisco, CA');
  });

  test('2.2 PATCH /api/profile rejects empty display name', async () => {
    const req = mockRequest('PATCH', { name: '   ' });
    const res = await profileRoute.PATCH(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /cannot be empty/i);
  });

  test('2.3 PATCH /api/profile rejects invalid username format', async () => {
    // Can't start with symbol
    const req1 = mockRequest('PATCH', { username: '-invalidstart' });
    const res1 = await profileRoute.PATCH(req1);
    assert.equal(res1.status, 400);

    // Can't have double dots
    const req2 = mockRequest('PATCH', { username: 'test..name' });
    const res2 = await profileRoute.PATCH(req2);
    assert.equal(res2.status, 400);

    // Too short
    const req3 = mockRequest('PATCH', { username: 'ab' });
    const res3 = await profileRoute.PATCH(req3);
    assert.equal(res3.status, 400);
  });

  test('2.4 PATCH /api/profile rejects username already claimed by another user', async () => {
    // Attempt to take testUser2's username
    const req = mockRequest('PATCH', { username: testUser2.username });
    const res = await profileRoute.PATCH(req);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.match(data.message, /already claimed/i);
  });

  test('2.5 PATCH /api/profile ignores protected fields (cannot change email or identity)', async () => {
    const initialEmail = testUser1.email;
    const req = mockRequest('PATCH', {
      email: 'hacked_email@attacker.com',
      identity: 'business',
    });
    const res = await profileRoute.PATCH(req);
    assert.equal(res.status, 200);

    const reloaded = await User.findById(testUser1._id);
    assert.equal(reloaded.email, initialEmail);
    assert.equal(reloaded.identity, 'student');
  });

  /* ---------------- 3. Image Magic Bytes & Storage Validation ---------------- */
  test('3.1 Magic bytes detection detects JPEG, PNG, and WebP accurately', () => {
    const jpeg = createValidJpegBuffer();
    const png = createValidPngBuffer();
    const webp = createValidWebpBuffer();
    const text = Buffer.from('This is a plain text file pretending to be an image');

    assert.equal(validationModule.detectImageMimeType(jpeg), 'image/jpeg');
    assert.equal(validationModule.detectImageMimeType(png), 'image/png');
    assert.equal(validationModule.detectImageMimeType(webp), 'image/webp');
    assert.equal(validationModule.detectImageMimeType(text), null);
  });

  test('3.2 Validation rejects spoofed image with invalid magic bytes', () => {
    const fakeJpg = Buffer.from('NOT A REAL JPEG FILE CONTENT');
    const result = validationModule.validateProfilePhotoImage(fakeJpg, 'image/jpeg');
    assert.equal(result.valid, false);
    assert.match(result.error, /invalid or unsupported image format/i);
  });

  test('3.3 Validation rejects image exceeding 2 MB', () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 100);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;

    const result = validationModule.validateProfilePhotoImage(oversized, 'image/jpeg');
    assert.equal(result.valid, false);
    assert.match(result.error, /exceeds maximum allowed size/i);
  });

  /* ---------------- 4. Local Storage Path Traversal Prevention ---------------- */
  test('4.1 Local storage sanitizeKey rejects path traversal attempts', () => {
    const localProvider = new localStorageModule.LocalStorageProvider();

    assert.throws(() => localProvider.sanitizeKey('../escaped.jpg'), /traversal/i);
    assert.throws(() => localProvider.sanitizeKey('folder/file.png'), /traversal/i);
    assert.throws(() => localProvider.sanitizeKey('..\\escaped.png'), /traversal/i);
    assert.throws(() => localProvider.sanitizeKey('/etc/passwd'), /traversal/i);

    // Legitimate key passes
    const validKey = 'user_123_456_abcdef.jpg';
    assert.equal(localProvider.sanitizeKey(validKey), validKey);
  });

  /* ---------------- 5. Photo Upload, Replacement & Removal ---------------- */
  let uploadedKey = null;

  test('5.1 Valid photo upload persists key to MongoDB and writes file to disk', async () => {
    const validBuffer = createValidJpegBuffer();

    const mockFormData = {
      get: (key) => {
        if (key === 'file') {
          return {
            size: validBuffer.length,
            type: 'image/jpeg',
            arrayBuffer: async () => validBuffer.buffer.slice(validBuffer.byteOffset, validBuffer.byteOffset + validBuffer.byteLength),
          };
        }
        return null;
      },
    };

    const req = mockRequest('POST', null, testToken1, mockFormData);
    const res = await photoRoute.POST(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(data.profilePhotoKey);
    assert.ok(data.profilePhotoUrl);
    uploadedKey = data.profilePhotoKey;

    const updatedUser = await User.findById(testUser1._id);
    assert.equal(updatedUser.profilePhotoKey, uploadedKey);
    assert.ok(updatedUser.profilePhotoUpdatedAt);

    // Verify file exists on disk
    const storage = storageIndexModule.getProfilePhotoStorage();
    const readBack = await storage.read(uploadedKey);
    assert.ok(readBack);
    assert.equal(readBack.contentType, 'image/jpeg');
  });

  test('5.2 GET /api/profile/photo/[key] serves the local image with cache headers', async () => {
    assert.ok(uploadedKey);
    const req = { method: 'GET' };
    const res = await photoKeyRoute.GET(req, { params: Promise.resolve({ key: uploadedKey }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('cache-control'), /public, max-age=31536000/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('5.3 Photo replacement unlinks old photo file and updates DB to new key', async () => {
    const oldKey = uploadedKey;
    const pngBuffer = createValidPngBuffer();

    const mockFormData = {
      get: (key) => {
        if (key === 'file') {
          return {
            size: pngBuffer.length,
            type: 'image/png',
            arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
          };
        }
        return null;
      },
    };

    const req = mockRequest('POST', null, testToken1, mockFormData);
    const res = await photoRoute.POST(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    const newKey = data.profilePhotoKey;
    assert.notEqual(newKey, oldKey);
    uploadedKey = newKey;

    const storage = storageIndexModule.getProfilePhotoStorage();
    // Verify old key was unlinked
    const oldFile = await storage.read(oldKey);
    assert.equal(oldFile, null);

    // Verify new key is readable
    const newFile = await storage.read(newKey);
    assert.ok(newFile);
    assert.equal(newFile.contentType, 'image/png');
  });

  test('5.4 DELETE /api/profile/photo removes photo file and clears DB fields', async () => {
    const keyToDelete = uploadedKey;
    const req = mockRequest('DELETE');
    const res = await photoRoute.DELETE(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.profilePhotoUrl, null);

    const updatedUser = await User.findById(testUser1._id);
    assert.equal(updatedUser.profilePhotoKey, null);
    assert.equal(updatedUser.profilePhotoUpdatedAt, null);

    const storage = storageIndexModule.getProfilePhotoStorage();
    const checkFile = await storage.read(keyToDelete);
    assert.equal(checkFile, null);
  });

  /* ---------------- 6. R2 Storage Configuration Behavior ---------------- */
  test('6.1 R2 provider throws explicit configuration error when credentials missing', () => {
    // Clear R2 env vars to test strict validation
    const oldStorage = process.env.PROFILE_PHOTO_STORAGE;
    const oldAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    delete process.env.CLOUDFLARE_R2_BUCKET_NAME;

    assert.throws(
      () => new r2StorageModule.R2StorageProvider(),
      /Cloudflare R2 is configured as the active storage provider.*missing/i
    );

    process.env.PROFILE_PHOTO_STORAGE = oldStorage || 'local';
    if (oldAccountId) process.env.CLOUDFLARE_ACCOUNT_ID = oldAccountId;
  });

  /* ---------------- 7. Change Password Route ---------------- */
  test('7.1 Change password rejects incorrect current password', async () => {
    const req = mockRequest('POST', {
      currentPassword: 'WrongPassword!',
      newPassword: 'BrandNewPassword123!',
      confirmPassword: 'BrandNewPassword123!',
    });
    const res = await changePasswordRoute.POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /current password you entered is incorrect/i);
  });

  test('7.2 Change password rejects mismatched confirmation', async () => {
    const req = mockRequest('POST', {
      currentPassword: 'CurrentSecret123!',
      newPassword: 'BrandNewPassword123!',
      confirmPassword: 'DifferentPassword456!',
    });
    const res = await changePasswordRoute.POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /do not match/i);
  });

  test('7.3 Change password succeeds with valid credentials and updates DB hash', async () => {
    const req = mockRequest('POST', {
      currentPassword: 'CurrentSecret123!',
      newPassword: 'BrandNewPassword123!',
      confirmPassword: 'BrandNewPassword123!',
    });
    const res = await changePasswordRoute.POST(req);
    assert.equal(res.status, 200);

    const userWithPw = await User.findById(testUser1._id).select('+password');
    const isNewMatch = await bcrypt.compare('BrandNewPassword123!', userWithPw.password);
    assert.equal(isNewMatch, true);
  });

  /* ---------------- 8. Legacy User Backward Compatibility ---------------- */
  test('8.1 Legacy user without profile photo fields retrieves smoothly', async () => {
    // User2 has no profilePhotoKey
    const req = mockRequest('GET', null, testToken2);
    const res = await profileRoute.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.profilePhotoKey, null);
    assert.equal(data.user.profilePhotoUrl, null);
    assert.equal(data.user.id, testUser2._id.toString());
  });
});
