/**
 * OneVue — Identity Workspace (Visiting Card + Website) for non-student identities
 *
 * Verifies:
 * 1. Domain profiles map into the shared public profile contract without private data.
 * 2. Professional and business users can preview and publish a website from their
 *    own identity profile, and the public endpoint serves the published snapshot.
 * 3. Visiting cards for non-student users are seeded from their identity profile.
 * 4. A non-student user without a saved profile cannot preview or publish.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

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
const uri = envFile.match(/MONGODB_URI="([^"]+)"/)[1];
const matchJwt = envFile.match(/JWT_SECRET="([^"]+)"/);
const jwtSecret = matchJwt ? matchJwt[1] : "fallback_secret";

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

let User, ProfessionalProfile, BusinessProfile, UserWebsiteConfig, PublishedProfileRevision, VisitingCard;
let configRoute, previewRoute, publishRoute, publicProfileRoute, cardRoute, websiteSource;

function authed(url, token, method = "GET", body) {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("OneVue — Identity workspace for non-student identities", () => {
  const runId = Date.now();
  const createdUserIds = [];
  let proUser, bizUser, emptyUser;
  let proToken, bizToken, emptyToken;
  const proUsername = `pro_${runId}`;
  const bizUsername = `biz_${runId}`;

  before(async () => {
    await mongoose.connect(uri);

    User = require(path.join(projectRoot, "models", "User.ts")).default;
    ProfessionalProfile = require(path.join(projectRoot, "models", "ProfessionalProfile.ts")).default;
    BusinessProfile = require(path.join(projectRoot, "models", "BusinessProfile.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    PublishedProfileRevision = require(path.join(projectRoot, "models", "PublishedProfileRevision.ts")).default;
    VisitingCard = require(path.join(projectRoot, "models", "VisitingCard.ts")).default;

    configRoute = require(path.join(projectRoot, "app", "api", "student", "website", "config", "route.ts"));
    previewRoute = require(path.join(projectRoot, "app", "api", "student", "website", "preview", "route.ts"));
    publishRoute = require(path.join(projectRoot, "app", "api", "student", "website", "publish", "route.ts"));
    publicProfileRoute = require(path.join(projectRoot, "app", "api", "public", "profile", "[username]", "route.ts"));
    cardRoute = require(path.join(projectRoot, "app", "api", "student", "card", "route.ts"));
    websiteSource = require(path.join(projectRoot, "lib", "domain-profile", "website-source.ts"));

    proUser = await User.create({
      name: "Priya Professional",
      email: `pro_${runId}@example.com`,
      password: "hashed_password",
      identity: "professional",
    });
    bizUser = await User.create({
      name: "Bianca Business",
      email: `biz_${runId}@example.com`,
      password: "hashed_password",
      identity: "business",
    });
    emptyUser = await User.create({
      name: "Fred Freelancer",
      email: `free_${runId}@example.com`,
      password: "hashed_password",
      identity: "freelancer",
    });
    createdUserIds.push(proUser._id, bizUser._id, emptyUser._id);
    proToken = jwt.sign({ id: proUser._id.toString(), email: proUser.email }, jwtSecret);
    bizToken = jwt.sign({ id: bizUser._id.toString(), email: bizUser.email }, jwtSecret);
    emptyToken = jwt.sign({ id: emptyUser._id.toString(), email: emptyUser.email }, jwtSecret);

    await ProfessionalProfile.create({
      userId: proUser._id,
      headline: "Staff Platform Engineer",
      bio: "Builds reliable distributed systems.",
      currentEmployment: { jobTitle: "Staff Engineer", company: "Acme Cloud", isCurrent: true, startDate: "2021-04" },
      skills: [{ name: "Kubernetes", proficiency: "Expert" }],
      contact: {
        email: "priya.public@example.com",
        phone: "+1-555-PRIVATE",
        city: "Austin",
        country: "USA",
        visibility: { email: "public", phone: "private" },
      },
    });

    await BusinessProfile.create({
      userId: bizUser._id,
      businessName: "Bianca Studio Ltd",
      description: "Design systems for growing teams.",
      industry: "Design",
      organizationType: "llc",
      products: [{ name: "Brand Kit", description: "Ready-made brand assets" }],
      team: [
        { name: "Public Lead", role: "Founder", isPublic: true },
        { name: "Hidden Member", role: "Analyst", isPublic: false },
      ],
      registration: { legalName: "Bianca Studio Ltd", registrationNumber: "REG-SECRET-123" },
      location: { city: "Leeds", country: "UK", addressLine: "1 Secret Street" },
      resources: [
        { title: "Public deck", url: "https://example.com/deck", visibility: "public" },
        { title: "Internal pricing", url: "https://example.com/internal", visibility: "private" },
      ],
      publicContact: { email: "hidden@example.com", visibility: { email: "private", phone: "private" } },
    });
  });

  after(async () => {
    await VisitingCard.deleteMany({ userId: { $in: createdUserIds } });
    await UserWebsiteConfig.deleteMany({ userId: { $in: createdUserIds } });
    await PublishedProfileRevision.deleteMany({ userId: { $in: createdUserIds } });
    await ProfessionalProfile.deleteMany({ userId: { $in: createdUserIds } });
    await BusinessProfile.deleteMany({ userId: { $in: createdUserIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await mongoose.disconnect();
  });

  test("1.1 Business mapping drops registration numbers, addresses, private team, resources, and contacts", () => {
    const source = websiteSource.domainProfileToPublicSource("business", {
      businessName: "Acme",
      registration: { registrationNumber: "REG-SECRET-999", documentStorageKey: "s3://secret" },
      location: { city: "Paris", addressLine: "9 Hidden Road" },
      team: [
        { name: "Shown", role: "CEO", isPublic: true },
        { name: "NotShown", role: "Ops", isPublic: false },
      ],
      resources: [{ title: "Private", url: "https://example.com/p", visibility: "private" }],
      publicContact: { email: "private@example.com", visibility: { email: "private" } },
    });
    const dump = JSON.stringify(source);
    assert.equal(dump.includes("REG-SECRET-999"), false);
    assert.equal(dump.includes("s3://secret"), false);
    assert.equal(dump.includes("9 Hidden Road"), false);
    assert.equal(dump.includes("NotShown"), false);
    assert.equal(dump.includes("https://example.com/p"), false);
    assert.equal(dump.includes("private@example.com"), false);
    assert.equal(source.preferredName, "Acme");
    assert.equal(source.achievements.length, 1);
  });

  test("1.2 Professional mapping turns employment into experience entries", () => {
    const source = websiteSource.domainProfileToPublicSource("professional", {
      headline: "Engineer",
      currentEmployment: { jobTitle: "Lead", company: "Globex", isCurrent: true },
      employmentHistory: [{ jobTitle: "Engineer", company: "Initech", startDate: "2018-01", endDate: "2020-12" }],
    });
    assert.deepEqual(
      source.achievements.map((a) => a.title),
      ["Lead at Globex", "Engineer at Initech"]
    );
    assert.equal(source.achievements[0].category, "experience");
  });

  test("2.1 Freelancer without a saved profile cannot preview or publish", async () => {
    const previewRes = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", emptyToken));
    assert.equal(previewRes.status, 400);
    const previewData = await previewRes.json();
    assert.match(previewData.message, /identity profile/i);

    await configRoute.PUT(
      authed("http://localhost:3000/api/student/website/config", emptyToken, "PUT", {
        username: `free_${runId}`,
        selectedTemplateId: "magicui-portfolio",
      })
    );
    const publishRes = await publishRoute.POST(
      authed("http://localhost:3000/api/student/website/publish", emptyToken, "POST")
    );
    assert.equal(publishRes.status, 400);
  });

  test("2.2 Professional preview is built from the professional profile", async () => {
    const res = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", proToken));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.dto.profile.headline, "Staff Platform Engineer");
    assert.equal(data.dto.profile.displayName, "Priya Professional");
    assert.equal(data.dto.skills[0].name, "Kubernetes");
    assert.equal(data.dto.contact.email, "priya.public@example.com");
    assert.equal(JSON.stringify(data).includes("+1-555-PRIVATE"), false);
  });

  test("2.3 Professional publishes and the public endpoint serves the snapshot", async () => {
    const configRes = await configRoute.PUT(
      authed("http://localhost:3000/api/student/website/config", proToken, "PUT", {
        username: proUsername,
        selectedTemplateId: "magicui-portfolio",
      })
    );
    assert.equal(configRes.status, 200);

    const publishRes = await publishRoute.POST(
      authed("http://localhost:3000/api/student/website/publish", proToken, "POST")
    );
    assert.equal(publishRes.status, 200);
    const published = await publishRes.json();
    assert.equal(published.revision.revisionNumber, 1);

    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${proUsername}`), {
      params: Promise.resolve({ username: proUsername }),
    });
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    assert.equal(publicData.dto.profile.headline, "Staff Platform Engineer");
    assert.ok(publicData.dto.achievements.some((a) => a.title === "Staff Engineer at Acme Cloud"));
    assert.equal(JSON.stringify(publicData).includes("+1-555-PRIVATE"), false);
  });

  test("2.4 Business publishes without exposing private registration or team data", async () => {
    await configRoute.PUT(
      authed("http://localhost:3000/api/student/website/config", bizToken, "PUT", {
        username: bizUsername,
        selectedTemplateId: "magicui-portfolio",
      })
    );
    const publishRes = await publishRoute.POST(
      authed("http://localhost:3000/api/student/website/publish", bizToken, "POST")
    );
    assert.equal(publishRes.status, 200);

    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${bizUsername}`), {
      params: Promise.resolve({ username: bizUsername }),
    });
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    assert.equal(publicData.dto.profile.displayName, "Bianca Studio Ltd");
    assert.equal(publicData.dto.projects[0].title, "Brand Kit");
    const dump = JSON.stringify(publicData);
    for (const secret of ["REG-SECRET-123", "1 Secret Street", "Hidden Member", "https://example.com/internal", "hidden@example.com"]) {
      assert.equal(dump.includes(secret), false, `public snapshot leaked ${secret}`);
    }
  });

  test("3.1 Professional visiting card is seeded from the professional profile", async () => {
    const res = await cardRoute.GET(authed("http://localhost:3000/api/student/card", proToken));
    assert.equal(res.status, 200);
    const data = await res.json();
    const elements = data.card.designDocument.elements;
    assert.equal(elements.find((el) => el.id === "el_name").content, "Priya Professional");
    assert.equal(elements.find((el) => el.id === "el_title").content, "Staff Platform Engineer");
  });
});
