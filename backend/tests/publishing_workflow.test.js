/**
 * OneVue Phase 3 — Publishing API, Preview Engine & Rollback Test Suite
 *
 * Verifies:
 * 1. Configuration: Unauthenticated rejected, user isolation, invalid username/template,
 *    duplicate username 409 conflict, protected server fields (activeRevisionId/status).
 * 2. Preview: Authenticated draft DTO generation, isolation to owner, does not mutate
 *    or activate revision, private fields excluded.
 * 3. Publishing: Explicit publication creates immutable PublishedProfileRevision,
 *    allocates linear revision numbers, atomically activates pointer, handles minimum
 *    validation, identity edits do NOT auto-publish.
 * 4. Public Endpoint: Unpublished returns 404, published returns active DTO, editing
 *    profile after publication does not affect public view until republished,
 *    sensitive fields stripped, safe no-store cache headers.
 * 5. Rollback: Prior revision activation without mutating history, cross-user rollback
 *    rejected, non-existent revision rejected.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

// Register TypeScript loader on the fly for CommonJS test runner
if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    });
    module._compile(compiled.outputText, filename);
  };
}

const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

let User, StudentProfile, UserWebsiteConfig, PublishedProfileRevision;
let configRoute, previewRoute, publishRoute, publicProfileRoute, rollbackRoute, historyRoute;

describe("OneVue Phase 3 — Publishing, Preview & Revision Workflow", () => {
  let user1, user2;
  let token1, token2;
  const createdUserIds = [];
  const testRunId = Date.now();
  const username1 = `alex_${testRunId}`.toLowerCase();
  const username2 = `sara_${testRunId}`.toLowerCase();

  before(async () => {
    await mongoose.connect(uri);

    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    PublishedProfileRevision = require(path.join(projectRoot, "models", "PublishedProfileRevision.ts")).default;

    configRoute = require(path.join(projectRoot, "app", "api", "student", "website", "config", "route.ts"));
    previewRoute = require(path.join(projectRoot, "app", "api", "student", "website", "preview", "route.ts"));
    publishRoute = require(path.join(projectRoot, "app", "api", "student", "website", "publish", "route.ts"));
    publicProfileRoute = require(path.join(projectRoot, "app", "api", "public", "profile", "[username]", "route.ts"));
    rollbackRoute = require(path.join(projectRoot, "app", "api", "student", "website", "rollback", "route.ts"));
    historyRoute = require(path.join(projectRoot, "app", "api", "student", "website", "history", "route.ts"));

    // Create User 1
    user1 = await User.create({
      name: "Alex Rivera",
      email: `alex_${testRunId}@example.com`,
      password: "hashed_password",
      identity: "student",
    });
    createdUserIds.push(user1._id);
    token1 = jwt.sign({ id: user1._id.toString(), email: user1.email }, jwtSecret);

    // Create User 2 (for isolation & cross-user tests)
    user2 = await User.create({
      name: "Sara Connor",
      email: `sara_${testRunId}@example.com`,
      password: "hashed_password",
      identity: "student",
    });
    createdUserIds.push(user2._id);
    token2 = jwt.sign({ id: user2._id.toString(), email: user2.email }, jwtSecret);

    // Initialize StudentProfile for User 1
    await StudentProfile.create({
      userId: user1._id,
      preferredName: "Alex Rivera",
      headline: "Distributed Systems Researcher & Full-Stack Engineer",
      bio: "Undergraduate student passionate about cloud architecture and distributed stores.",
      dob: "2003-05-14", // PRIVATE
      gender: "non-binary", // PRIVATE
      education: [
        {
          institution: "University of Waterloo",
          degree: "Bachelor of Computer Science",
          currentStatus: "studying",
          rollNumber: "UW-SECRET-ROLL-01", // PRIVATE
          website: "https://uwaterloo.ca",
        },
      ],
      projects: [
        {
          title: "Nebula KV",
          shortDescription: "A Raft-backed key-value store in Go",
          technologies: ["Go", "Raft", "gRPC"],
          liveUrl: "https://nebulakv.io",
          repoUrl: "https://github.com/alex/nebula-kv",
        },
      ],
      skills: [
        {
          name: "Go",
          category: "Programming Languages",
          proficiency: "Advanced",
        },
      ],
      contacts: {
        email: "alex.public@example.com",
        phone: "+1-555-0199",
        visibility: {
          email: "public",
          phone: "private", // PRIVATE
        },
        github: "https://github.com/alexrivera",
      },
      resumeUrl: "https://cdn.onevue.id/resumes/alex.pdf",
    });
  });

  after(async () => {
    if (createdUserIds.length > 0) {
      await UserWebsiteConfig.deleteMany({ userId: { $in: createdUserIds } });
      await PublishedProfileRevision.deleteMany({ userId: { $in: createdUserIds } });
      await StudentProfile.deleteMany({ userId: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  });

  /* =========================================================================
     1. Website Configuration Tests
     ========================================================================= */

  test("1.1 Config GET without token returns 401", async () => {
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "GET",
    });
    const res = await configRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test("1.2 Config GET returns config: null when not initialized", async () => {
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "GET",
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await configRoute.GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.config, null);
  });

  test("1.3 Config PUT validates username format and approved template ID", async () => {
    // Bad username (uppercase, ends with symbol)
    const req1 = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "Alex-" }),
    });
    const res1 = await configRoute.PUT(req1);
    assert.equal(res1.status, 400);

    // Unapproved template ID
    const req2 = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username1,
        selectedTemplateId: "malicious-template-exploit",
      }),
    });
    const res2 = await configRoute.PUT(req2);
    assert.equal(res2.status, 400);
  });

  test("1.4 Config PUT initializes valid configuration", async () => {
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username1,
        selectedTemplateId: "magicui-portfolio",
        customization: {
          accentColor: "#2563eb",
          themeMode: "dark",
        },
      }),
    });
    const res = await configRoute.PUT(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.config.username, username1);
    assert.equal(data.config.status, "draft");
    assert.equal(data.config.activeRevisionId, null);
  });

  test("1.5 Config PUT rejects client override of activeRevisionId or status='published'", async () => {
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        activeRevisionId: "660c00000000000000000099",
      }),
    });
    const res = await configRoute.PUT(req);
    assert.equal(res.status, 400);

    const reqStatus = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "published",
      }),
    });
    const resStatus = await configRoute.PUT(reqStatus);
    assert.equal(resStatus.status, 400);
  });

  test("1.6 Duplicate username claim by another user returns 409 conflict", async () => {
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username1, // Already claimed by User 1!
      }),
    });
    const res = await configRoute.PUT(req);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.ok(data.message.includes("already claimed"));
  });

  /* =========================================================================
     2. Authenticated Draft Preview Tests
     ========================================================================= */

  test("2.1 Preview without token returns 401", async () => {
    const req = new Request("http://localhost:3000/api/student/website/preview", {
      method: "GET",
    });
    const res = await previewRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test("2.2 Preview returns latest saved profile data as DTO without mutating active revision", async () => {
    const req = new Request("http://localhost:3000/api/student/website/preview", {
      method: "GET",
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await previewRoute.GET(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-cache, no-store, must-revalidate");

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.preview, true);
    assert.equal(data.dto.profile.displayName, "Alex Rivera");
    assert.equal(data.dto.projects[0].title, "Nebula KV");

    // Privacy verification: dob, gender, rollNumber, private phone stripped
    assert.equal("dob" in data.dto.profile, false);
    assert.equal("gender" in data.dto.profile, false);
    assert.equal(data.dto.contact.phone, undefined); // Private phone suppressed
    assert.equal(data.dto.contact.email, "alex.public@example.com"); // Public email allowed
    assert.equal("rollNumber" in data.dto.education[0], false);

    // Verify preview did NOT publish or set activeRevisionId
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    assert.equal(config.activeRevisionId, null);
    assert.equal(config.status, "draft");
  });

  /* =========================================================================
     3. Explicit Publishing Tests
     ========================================================================= */

  test("3.1 Publish without token returns 401", async () => {
    const req = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
    });
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 401);
  });

  test("3.2 User without website config / claimed username cannot publish (returns 400)", async () => {
    const req = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token2}` },
    });
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.message.includes("username is required"));
  });

  let firstPublicationData;

  test("3.3 Valid publish creates immutable PublishedProfileRevision and activates pointer", async () => {
    const req = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.revision.revisionNumber, 1);
    assert.ok(data.revision.id);
    assert.equal(data.publicUrl, `https://onevue.id/p/${username1}`);
    firstPublicationData = data;

    // Verify database state: config pointer updated to revision 1
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    assert.equal(config.status, "published");
    assert.equal(String(config.activeRevisionId), String(data.revision.id));

    // Verify revision document in MongoDB
    const revDoc = await PublishedProfileRevision.findById(data.revision.id);
    assert.ok(revDoc);
    assert.equal(revDoc.revisionNumber, 1);
    assert.equal(revDoc.snapshot.meta.schemaVersion, "1.0.0");
    assert.equal(revDoc.snapshot.profile.displayName, "Alex Rivera");
  });

  test("3.4 Identity edits do NOT automatically publish", async () => {
    // Edit canonical identity profile in MongoDB
    await StudentProfile.updateOne(
      { userId: user1._id },
      { $set: { headline: "Updated Unsaved Headline (Draft only)" } }
    );

    // Check that active publication snapshot remains UNCHANGED
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    const activeRev = await PublishedProfileRevision.findById(config.activeRevisionId);
    assert.equal(
      activeRev.snapshot.profile.headline,
      "Distributed Systems Researcher & Full-Stack Engineer"
    );
  });

  let secondPublicationData;

  test("3.5 Second explicit publish creates a distinct revision #2 and advances active pointer", async () => {
    const req = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await publishRoute.POST(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.revision.revisionNumber, 2);
    assert.notEqual(data.revision.id, firstPublicationData.revision.id);
    secondPublicationData = data;

    // Verify website config pointer updated to revision #2
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    assert.equal(String(config.activeRevisionId), String(data.revision.id));

    // Verify revision #1 is still completely preserved in MongoDB
    const rev1 = await PublishedProfileRevision.findById(firstPublicationData.revision.id);
    assert.ok(rev1);
    assert.equal(rev1.revisionNumber, 1);
  });

  /* =========================================================================
     4. Public Endpoint Tests
     ========================================================================= */

  test("4.1 Public profile for unpublished or non-existent username returns 404", async () => {
    const req = new Request("http://localhost:3000/api/public/profile/nobody_exists_here");
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: "nobody_exists_here" }),
    });
    assert.equal(res.status, 404);
  });

  test("4.2 Public profile returns only the active published snapshot", async () => {
    const req = new Request(`http://localhost:3000/api/public/profile/${username1}`);
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: username1 }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.website.username, username1);
    assert.equal(data.website.revisionNumber, 2);
    assert.equal(data.dto.profile.displayName, "Alex Rivera");
    assert.equal(data.dto.profile.headline, "Updated Unsaved Headline (Draft only)");

    // Verify sensitive data is physically absent from public response
    const rawDump = JSON.stringify(data);
    assert.equal(rawDump.includes("UW-SECRET-ROLL-01"), false);
    assert.equal(rawDump.includes("2003-05-14"), false);
    assert.equal(rawDump.includes("hashed_password"), false);
  });

  test("4.3 Public profile exposes the portfolio analytics resource without the owner id", async () => {
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    const res = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${username1}`), {
      params: Promise.resolve({ username: username1 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.analytics.resourceId, String(config._id));
    assert.equal(data.analytics.resourceType, "portfolio");
    const rawDump = JSON.stringify(data);
    assert.equal(rawDump.includes(String(user1._id)), false);
    assert.equal(rawDump.includes("objectKey"), false);
  });

  /* =========================================================================
     5. Rollback Tests
     ========================================================================= */

  test("5.1 Rollback without token returns 401", async () => {
    const req = new Request("http://localhost:3000/api/student/website/rollback", {
      method: "POST",
      body: JSON.stringify({ revisionNumber: 1 }),
    });
    const res = await rollbackRoute.POST(req);
    assert.equal(res.status, 401);
  });

  test("5.2 Cross-user rollback attempt is rejected with 404", async () => {
    // User 2 attempts to rollback to User 1's revision
    const req = new Request("http://localhost:3000/api/student/website/rollback", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ revisionId: firstPublicationData.revision.id }),
    });
    const res = await rollbackRoute.POST(req);
    assert.equal(res.status, 404);
  });

  test("5.3 Valid rollback activates prior revision #1 and updates public view atomically", async () => {
    const req = new Request("http://localhost:3000/api/student/website/rollback", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ revisionNumber: 1 }),
    });
    const res = await rollbackRoute.POST(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.activeRevision.revisionNumber, 1);
    assert.equal(String(data.activeRevision.id), String(firstPublicationData.revision.id));

    // Verify website config pointer points back to revision #1
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    assert.equal(String(config.activeRevisionId), String(firstPublicationData.revision.id));

    // Verify public endpoint now serves revision #1 snapshot!
    const publicReq = new Request(`http://localhost:3000/api/public/profile/${username1}`);
    const publicRes = await publicProfileRoute.GET(publicReq, {
      params: Promise.resolve({ username: username1 }),
    });
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    assert.equal(publicData.website.revisionNumber, 1);
    assert.equal(
      publicData.dto.profile.headline,
      "Distributed Systems Researcher & Full-Stack Engineer"
    );
  });

  test("5.4 Rollback to non-existent revision number returns 404", async () => {
    const req = new Request("http://localhost:3000/api/student/website/rollback", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ revisionNumber: 9999 }),
    });
    const res = await rollbackRoute.POST(req);
    assert.equal(res.status, 404);
  });

  /* -------------------------------------------------------------------------
     6. History Endpoint Tests (Phase 5 Foundation)
     ------------------------------------------------------------------------- */
  test("6.1 History without token returns 401", async () => {
    const req = new Request("http://localhost:3000/api/student/website/history");
    const res = await historyRoute.GET(req);
    assert.equal(res.status, 401);
  });

  test("6.2 History returns list of revisions with correct active indicator", async () => {
    const req = new Request("http://localhost:3000/api/student/website/history", {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await historyRoute.GET(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.username, username1);
    assert.equal(data.status, "published");
    assert.ok(Array.isArray(data.revisions));
    assert.equal(data.revisions.length, 2);

    // Revisions are sorted descending: rev #2, then rev #1
    assert.equal(data.revisions[0].revisionNumber, 2);
    assert.equal(data.revisions[1].revisionNumber, 1);

    // Because test 5.3 rolled back to rev #1, rev #1 should be active
    assert.equal(data.activeRevisionNumber, 1);
    const activeItem = data.revisions.find((r) => r.isActive);
    assert.ok(activeItem);
    assert.equal(activeItem.revisionNumber, 1);
  });

  test("6.3 History reflects active pointer accurately and provides required metadata", async () => {
    const req = new Request("http://localhost:3000/api/student/website/history", {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const res = await historyRoute.GET(req);
    const data = await res.json();

    const rev1 = data.revisions.find((r) => r.revisionNumber === 1);
    assert.ok(rev1.id);
    assert.ok(rev1.publishedAt);
    assert.ok(rev1.checksum);
    assert.equal(rev1.templateId, "magicui-portfolio");
  });

  test("6.4 Cross-user history isolation (user2 only sees user2 revisions)", async () => {
    const req = new Request("http://localhost:3000/api/student/website/history", {
      headers: { Authorization: `Bearer ${token2}` },
    });
    const res = await historyRoute.GET(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    // User 2 has not published yet
    assert.equal(data.revisions.length, 0);
    assert.equal(data.activeRevisionId, null);
  });
});
