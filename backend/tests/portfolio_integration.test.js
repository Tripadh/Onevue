/**
 * OneVue Phase 4 — Real End-to-End Integration Test Suite
 *
 * Validates real workflow against running MongoDB:
 * 1. A real student profile is created and published via the Phase 3 publishing route.
 * 2. The Phase 3 public route GET /api/public/profile/[username] serves the active snapshot.
 * 3. The Magic UI adapter (adaptOneVueProfile) transforms the live public response into
 *    the exact format expected by Magic UI components.
 * 4. Editing student identity draft does NOT alter the public endpoint or adapted output.
 * 5. Publishing revision #2 updates the public snapshot and adapted output immediately.
 * 6. Nonexistent or unpublished username returns 404.
 * 7. Invalid username returns 400.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const portfolioRoot = path.resolve(projectRoot, "..", "portfolio");
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

const envFile = fs.readFileSync(path.join(projectRoot, ".env.local"), "utf8");
const matchUri = envFile.match(/MONGODB_URI="([^"]+)"/);
const uri = matchUri[1];
const matchJwt = envFile.match(/JWT_SECRET="([^"]+)"/);
const jwtSecret = matchJwt ? matchJwt[1] : "fallback_secret";

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

let User, StudentProfile, UserWebsiteConfig, PublishedProfileRevision;
let configRoute, publishRoute, publicProfileRoute;
let adaptOneVueProfile;

describe("OneVue Phase 4 — Real Public Portfolio Integration", () => {
  let testUser;
  let testToken;
  const testRunId = Date.now();
  const testUsername = `real_magic_${testRunId}`.toLowerCase();

  before(async () => {
    await mongoose.connect(uri);

    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    PublishedProfileRevision = require(path.join(projectRoot, "models", "PublishedProfileRevision.ts")).default;

    configRoute = require(path.join(projectRoot, "app", "api", "student", "website", "config", "route.ts"));
    publishRoute = require(path.join(projectRoot, "app", "api", "student", "website", "publish", "route.ts"));
    publicProfileRoute = require(path.join(projectRoot, "app", "api", "public", "profile", "[username]", "route.ts"));

    // Import the Magic UI profile adapter
    const adapterModule = require(path.join(portfolioRoot, "src", "lib", "onevue-profile-adapter.ts"));
    adaptOneVueProfile = adapterModule.adaptOneVueProfile;

    // Create a real test user
    testUser = await User.create({
      name: "Marcus Aurelius",
      email: `marcus_${testRunId}@example.com`,
      password: "Password123!",
      role: "student",
    });

    testToken = jwt.sign(
      { id: testUser._id.toString(), email: testUser.email, role: "student" },
      jwtSecret,
      { expiresIn: "1h" }
    );
  });

  after(async () => {
    if (testUser) {
      await User.deleteOne({ _id: testUser._id });
      await StudentProfile.deleteOne({ userId: testUser._id });
      await UserWebsiteConfig.deleteOne({ userId: testUser._id });
      await PublishedProfileRevision.deleteMany({ userId: testUser._id });
    }
    await mongoose.disconnect();
  });

  test("1. Initializes website config and draft student profile", async () => {
    // Save draft student profile
    await StudentProfile.create({
      userId: testUser._id,
      headline: "Distributed Systems Researcher & Engineer",
      bio: "Focusing on consensus algorithms, high throughput queues, and modern UI.",
      education: [
        {
          institution: "University of Waterloo",
          degree: "Bachelor of Computer Science",
          fieldOfStudy: "Software Systems",
          startDate: "2021",
          endDate: "2025",
          currentStatus: "studying",
          website: "https://uwaterloo.ca",
        },
      ],
      projects: [
        {
          title: "HyperRaft",
          shortDescription: "Ultra-low latency Raft implementation in Rust",
          projectType: "personal",
          technologies: ["Rust", "Tokio", "gRPC"],
          liveUrl: "https://hyperraft.dev",
          repoUrl: "https://github.com/marcus/hyperraft",
        },
        {
          title: "CloudScale Internship",
          shortDescription: "Engineered scalable Kubernetes controllers",
          projectType: "internship",
          role: "Cloud Platform Intern",
          startDate: "May 2024",
          endDate: "Aug 2024",
          technologies: ["Go", "Kubernetes", "AWS"],
        },
      ],
      skills: [
        { name: "Rust", category: "Programming Languages", proficiency: "Expert" },
        { name: "Go", category: "Programming Languages", proficiency: "Advanced" },
      ],
      achievements: [
        {
          title: "HackTheNorth 2024 Finalist",
          category: "hackathon",
          organization: "Waterloo",
          date: "Sep 2024",
          awardPrize: "Top 10 Finalist",
          proofUrl: "https://devpost.com/software/hyperraft",
        },
      ],
      contacts: {
        email: "marcus.public@example.com",
        github: "https://github.com/marcus",
        linkedin: "https://linkedin.com/in/marcus",
        visibility: { email: "public" },
      },
    });

    // Claim username and configure website
    const req = new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${testToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: testUsername,
        selectedTemplateId: "magicui-portfolio",
        customization: {
          accentColor: "#3b82f6",
          themeMode: "system",
          visibleSections: ["about", "education", "projects", "skills", "achievements", "work", "contact"],
        },
      }),
    });
    const res = await configRoute.PUT(req);
    assert.equal(res.status, 200);
  });

  test("2. Unauthenticated request to unpublished username returns 404", async () => {
    const req = new Request(`http://localhost:3000/api/public/profile/${testUsername}`, {
      method: "GET",
    });
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: testUsername }),
    });
    assert.equal(res.status, 404);
  });

  test("3. Publishes Revision #1 and verifies Magic UI adapter transforms real DTO", async () => {
    // Explicit publish
    const pubReq = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
    });
    const pubRes = await publishRoute.POST(pubReq);
    assert.equal(pubRes.status, 200);
    const pubData = await pubRes.json();
    assert.equal(pubData.success, true);
    assert.equal(pubData.revision.revisionNumber, 1);

    // Call public endpoint
    const pubGetReq = new Request(`http://localhost:3000/api/public/profile/${testUsername}`);
    const pubGetRes = await publicProfileRoute.GET(pubGetReq, {
      params: Promise.resolve({ username: testUsername }),
    });
    assert.equal(pubGetRes.status, 200);
    const publicPayload = await pubGetRes.json();

    assert.equal(publicPayload.success, true);
    assert.equal(publicPayload.website.username, testUsername);
    assert.equal(publicPayload.website.templateId, "magicui-portfolio");
    assert.equal(publicPayload.website.revisionNumber, 1);

    // Pass the real API response to Magic UI adapter
    const adapted = adaptOneVueProfile(publicPayload.dto, publicPayload.website);

    assert.equal(adapted.name, "Marcus Aurelius");
    assert.equal(adapted.initials, "MA");
    assert.equal(adapted.description, "Distributed Systems Researcher & Engineer");
    assert.equal(adapted.education.length, 1);
    assert.equal(adapted.education[0].school, "University of Waterloo");
    assert.equal(adapted.projects.length, 2);
    assert.equal(adapted.projects[0].title, "HyperRaft");
    assert.equal(adapted.projects[0].href, "https://hyperraft.dev");
    assert.equal(adapted.work.length, 1);
    assert.equal(adapted.work[0].company, "CloudScale Internship");
    assert.equal(adapted.work[0].title, "Cloud Platform Intern");
    assert.equal(adapted.hackathons.length, 1);
    assert.equal(adapted.hackathons[0].title, "HackTheNorth 2024 Finalist");
    assert.equal(adapted.contact.email, "marcus.public@example.com");
    assert.ok(adapted.contact.social["GitHub"]);
    assert.ok(adapted.contact.social["LinkedIn"]);
    assert.equal(adapted.visibleSections.projects, true);
    assert.equal(adapted.visibleSections.work, true);
  });

  test("4. Editing draft profile does NOT change public response until republished", async () => {
    // Edit draft profile directly in database
    await StudentProfile.updateOne(
      { userId: testUser._id },
      { $set: { headline: "UNPUBLISHED DRAFT HEADLINE — SHOULD NOT LEAK" } }
    );

    // Call public endpoint
    const req = new Request(`http://localhost:3000/api/public/profile/${testUsername}`);
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: testUsername }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json();

    // Must still serve Revision #1 frozen snapshot!
    assert.equal(payload.dto.profile.headline, "Distributed Systems Researcher & Engineer");
    assert.notEqual(payload.dto.profile.headline, "UNPUBLISHED DRAFT HEADLINE — SHOULD NOT LEAK");

    const adapted = adaptOneVueProfile(payload.dto, payload.website);
    assert.equal(adapted.description, "Distributed Systems Researcher & Engineer");
  });

  test("5. Explicit publication of Revision #2 immediately updates public endpoint and adapter", async () => {
    // Explicit publish
    const pubReq = new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
    });
    const pubRes = await publishRoute.POST(pubReq);
    assert.equal(pubRes.status, 200);
    const pubData = await pubRes.json();
    assert.equal(pubData.revision.revisionNumber, 2);

    // Call public endpoint
    const req = new Request(`http://localhost:3000/api/public/profile/${testUsername}`);
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: testUsername }),
    });
    assert.equal(res.status, 200);
    const payload = await res.json();

    assert.equal(payload.website.revisionNumber, 2);
    assert.equal(payload.dto.profile.headline, "UNPUBLISHED DRAFT HEADLINE — SHOULD NOT LEAK");

    const adapted = adaptOneVueProfile(payload.dto, payload.website);
    assert.equal(adapted.description, "UNPUBLISHED DRAFT HEADLINE — SHOULD NOT LEAK");
  });

  test("6. Nonexistent username returns 404 from public endpoint", async () => {
    const req = new Request("http://localhost:3000/api/public/profile/completely_nonexistent_user_9999");
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: "completely_nonexistent_user_9999" }),
    });
    assert.equal(res.status, 404);
  });

  test("7. Empty/whitespace username returns 400 from public endpoint", async () => {
    const req = new Request("http://localhost:3000/api/public/profile/   ");
    const res = await publicProfileRoute.GET(req, {
      params: Promise.resolve({ username: "   " }),
    });
    assert.equal(res.status, 400);
  });
});
