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

const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;

let User, ProfessionalProfile, FreelancerProfile, CreatorProfile, BusinessProfile, StudentProfile, UserWebsiteConfig, PublishedProfileRevision, VisitingCard;
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
  let proUser, bizUser, emptyUser, freelancerUser, creatorUser, plainCreatorUser, studentUser, richUser;
  let proToken, bizToken, emptyToken, freelancerToken, creatorToken, plainCreatorToken, studentToken, richToken;
  const proUsername = `pro_${runId}`;
  const bizUsername = `biz_${runId}`;
  const freelancerUsername = `free2_${runId}`;
  const creatorUsername = `creator_${runId}`;
  const studentUsername = `student_${runId}`;
  const richUsername = `rich_${runId}`;

  before(async () => {
    await mongoose.connect(uri);

    User = require(path.join(projectRoot, "models", "User.ts")).default;
    ProfessionalProfile = require(path.join(projectRoot, "models", "ProfessionalProfile.ts")).default;
    FreelancerProfile = require(path.join(projectRoot, "models", "FreelancerProfile.ts")).default;
    CreatorProfile = require(path.join(projectRoot, "models", "CreatorProfile.ts")).default;
    BusinessProfile = require(path.join(projectRoot, "models", "BusinessProfile.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
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
    freelancerUser = await User.create({
      name: "Faye Freelancer",
      email: `faye_${runId}@example.com`,
      password: "hashed_password",
      identity: "freelancer",
    });
    creatorUser = await User.create({
      name: "Cora Creator",
      email: `cora_${runId}@example.com`,
      password: "hashed_password",
      identity: "creator",
    });
    plainCreatorUser = await User.create({
      name: "Nia Creator",
      email: `nia_${runId}@example.com`,
      password: "hashed_password",
      identity: "creator",
    });
    studentUser = await User.create({
      name: "Sam Student",
      email: `sam_${runId}@example.com`,
      password: "hashed_password",
      identity: "student",
    });
    richUser = await User.create({
      name: "Reed Business",
      email: `reed_${runId}@example.com`,
      password: "hashed_password",
      identity: "business",
    });
    createdUserIds.push(proUser._id, bizUser._id, emptyUser._id, freelancerUser._id, creatorUser._id, plainCreatorUser._id, studentUser._id, richUser._id);
    proToken = jwt.sign({ id: proUser._id.toString(), email: proUser.email }, jwtSecret);
    bizToken = jwt.sign({ id: bizUser._id.toString(), email: bizUser.email }, jwtSecret);
    emptyToken = jwt.sign({ id: emptyUser._id.toString(), email: emptyUser.email }, jwtSecret);
    freelancerToken = jwt.sign({ id: freelancerUser._id.toString(), email: freelancerUser.email }, jwtSecret);
    creatorToken = jwt.sign({ id: creatorUser._id.toString(), email: creatorUser.email }, jwtSecret);
    plainCreatorToken = jwt.sign({ id: plainCreatorUser._id.toString(), email: plainCreatorUser.email }, jwtSecret);
    studentToken = jwt.sign({ id: studentUser._id.toString(), email: studentUser.email }, jwtSecret);
    richToken = jwt.sign({ id: richUser._id.toString(), email: richUser.email }, jwtSecret);

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

    await FreelancerProfile.create({
      userId: freelancerUser._id,
      headline: "Brand designer",
      availability: "available",
      services: [{ name: "Logo design", description: "A wordmark and a symbol", pricingModel: "fixed" }],
    });

    await CreatorProfile.create({
      userId: plainCreatorUser._id,
      niche: "Cooking",
      bio: "Recipes and notes.",
    });

    await CreatorProfile.create({
      userId: creatorUser._id,
      niche: "Technology essays",
      bio: "Independent reporting.",
      displayName: "Cora Writes",
      featuredContent: [{
        title: "Launch essay",
        url: "https://cora.example/launch",
        thumbnailUrl: "https://cdn.example/cora.jpg",
      }],
      pastCollaborations: [{ organization: "Northwind", title: "Spring essay" }],
    });

    await StudentProfile.create({
      userId: studentUser._id,
      preferredName: "Sam Student",
      headline: "Computer science student",
      education: [{
        institution: "State University",
        degree: "BSc",
        currentStatus: "studying",
        rollNumber: "ROLL-SECRET-77",
      }],
      contacts: {
        email: "sam.public@example.com",
        phone: "+1-555-STUDENT-PRIVATE",
        visibility: { email: "public", phone: "private" },
      },
    });

    await BusinessProfile.create({
      userId: richUser._id,
      businessName: "Reed Goods",
      tagline: "Goods for studios",
      description: "Small-batch goods.",
      foundedYear: 2014,
      products: [{ name: "Lamp", description: "A desk lamp", price: 80, currency: "USD", imageUrl: "https://cdn.example/lamp.jpg" }],
      credentials: [{ recordType: "award", title: "Design prize", issuer: "Museum" }],
      registration: { registrationNumber: "REG-RICH-SECRET" },
    });
  });

  after(async () => {
    await VisitingCard.deleteMany({ userId: { $in: createdUserIds } });
    await UserWebsiteConfig.deleteMany({ userId: { $in: createdUserIds } });
    await PublishedProfileRevision.deleteMany({ userId: { $in: createdUserIds } });
    await ProfessionalProfile.deleteMany({ userId: { $in: createdUserIds } });
    await FreelancerProfile.deleteMany({ userId: { $in: createdUserIds } });
    await CreatorProfile.deleteMany({ userId: { $in: createdUserIds } });
    await BusinessProfile.deleteMany({ userId: { $in: createdUserIds } });
    await StudentProfile.deleteMany({ userId: { $in: createdUserIds } });
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
    assert.equal(source.team.length, 1);
    assert.equal(source.team[0].name, "Shown");
    assert.equal(source.team[0].role, "CEO");
    assert.equal(source.achievements.length, 0);
  });

  test("1.2 Professional mapping turns employment into experience entries", () => {
    const source = websiteSource.domainProfileToPublicSource("professional", {
      headline: "Engineer",
      currentEmployment: { jobTitle: "Lead", company: "Globex", isCurrent: true },
      employmentHistory: [{ jobTitle: "Engineer", company: "Initech", startDate: "2018-01", endDate: "2020-12" }],
    });
    assert.deepEqual(
      source.experience.map((item) => `${item.title} at ${item.organization}`),
      ["Lead at Globex", "Engineer at Initech"]
    );
    assert.equal(source.experience[0].isCurrent, true);
    assert.equal(source.achievements.length, 0);
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
    assert.ok(publicData.dto.experience.some((item) => item.title === "Staff Engineer" && item.organization === "Acme Cloud"));
    assert.equal(publicData.dto.achievements.some((item) => item.category === "experience"), false);
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

  test("2.5 older freelancer profile previews and publishes without package or experience fields", async () => {
    const previewRes = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", freelancerToken));
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.dto.profile.headline, "Brand designer");
    assert.equal(preview.dto.profile.displayName, "Faye Freelancer");
    assert.equal(preview.dto.projects[0].title, "Logo design");
    assert.equal(preview.dto.projects[0].shortDescription.includes("Package:"), false);

    await configRoute.PUT(authed("http://localhost:3000/api/student/website/config", freelancerToken, "PUT", {
      username: freelancerUsername,
      selectedTemplateId: "magicui-portfolio",
    }));
    const publishRes = await publishRoute.POST(authed("http://localhost:3000/api/student/website/publish", freelancerToken, "POST", {
      userId: proUser._id.toString(),
    }));
    assert.equal(publishRes.status, 200);
    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${freelancerUsername}`), {
      params: Promise.resolve({ username: freelancerUsername }),
    });
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    assert.equal(publicData.dto.profile.headline, "Brand designer");
    assert.equal(publicData.dto.projects[0].title, "Logo design");
    assert.equal(JSON.stringify(publicData).includes("Staff Platform Engineer"), false);
    const stored = await PublishedProfileRevision.findOne({ userId: freelancerUser._id });
    assert.equal(String(stored.userId), String(freelancerUser._id));
  });

  test("2.6 an older creator profile without the new fields still previews", async () => {
    const res = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", plainCreatorToken));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.dto.profile.displayName, "Nia Creator");
    assert.equal(data.dto.profile.headline, "Cooking");
    assert.equal(data.dto.profile.bio, "Recipes and notes.");
    assert.equal(data.dto.projects.length, 0);
    assert.equal(JSON.stringify(data).includes("Thumbnail:"), false);
  });

  test("2.6b creator preview uses the saved creator profile", async () => {
    const previewRes = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", creatorToken));
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.dto.profile.displayName, "Cora Writes");
    assert.equal(preview.dto.profile.headline, "Technology essays");
    assert.equal(preview.dto.projects[0].imageUrl, "https://cdn.example/cora.jpg");
    assert.equal(String(preview.dto.projects[0].shortDescription || "").includes("Thumbnail:"), false);
    assert.ok(preview.dto.achievements.some((item) => item.title === "Spring essay"));

    await configRoute.PUT(authed("http://localhost:3000/api/student/website/config", creatorToken, "PUT", {
      username: creatorUsername,
      selectedTemplateId: "magicui-portfolio",
    }));
    const publishRes = await publishRoute.POST(authed("http://localhost:3000/api/student/website/publish", creatorToken, "POST"));
    assert.equal(publishRes.status, 200);
    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${creatorUsername}`), {
      params: Promise.resolve({ username: creatorUsername }),
    });
    const publicData = await publicRes.json();
    assert.equal(publicData.dto.profile.displayName, "Cora Writes");
    assert.equal(publicData.dto.profile.headline, "Technology essays");
  });

  test("2.7 student preview and publish still use the student profile", async () => {
    const previewRes = await previewRoute.GET(authed(`http://localhost:3000/api/student/website/preview?userId=${proUser._id}`, studentToken));
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.dto.profile.displayName, "Sam Student");
    assert.equal(preview.dto.profile.headline, "Computer science student");
    assert.equal(preview.dto.contact.phone, undefined);
    assert.equal(JSON.stringify(preview).includes("ROLL-SECRET-77"), false);
    assert.equal(JSON.stringify(preview).includes("Staff Platform Engineer"), false);

    await configRoute.PUT(authed("http://localhost:3000/api/student/website/config", studentToken, "PUT", {
      username: studentUsername,
      selectedTemplateId: "magicui-portfolio",
    }));
    const publishRes = await publishRoute.POST(authed("http://localhost:3000/api/student/website/publish", studentToken, "POST", {
      userId: bizUser._id.toString(),
    }));
    assert.equal(publishRes.status, 200);
    assert.equal((await publishRes.json()).revision.revisionNumber, 1);
    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${studentUsername}`), {
      params: Promise.resolve({ username: studentUsername }),
    });
    const dump = JSON.stringify(await publicRes.json());
    assert.equal(dump.includes("ROLL-SECRET-77"), false);
    assert.equal(dump.includes("REG-SECRET-123"), false);
    assert.equal(dump.includes("+1-555-STUDENT-PRIVATE"), false);
  });

  test("2.8 a signed-in user cannot preview another user's identity profile", async () => {
    const res = await previewRoute.GET(authed(`http://localhost:3000/api/student/website/preview?userId=${bizUser._id}`, proToken));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.dto.profile.headline, "Staff Platform Engineer");
    assert.equal(data.dto.profile.displayName, "Priya Professional");
    const dump = JSON.stringify(data);
    assert.equal(dump.includes("Bianca Studio Ltd"), false);
    assert.equal(dump.includes("REG-SECRET-123"), false);
    assert.equal(dump.includes("1 Secret Street"), false);
  });

  test("2.9 populated business fields are published and private registration stays hidden", async () => {
    const previewRes = await previewRoute.GET(authed("http://localhost:3000/api/student/website/preview", richToken));
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    assert.equal(preview.dto.profile.headline, "Goods for studios");
    assert.match(preview.dto.profile.bio, /2014/);
    assert.match(preview.dto.projects[0].shortDescription, /USD 80/);
    assert.equal(preview.dto.projects[0].imageUrl, "https://cdn.example/lamp.jpg");
    assert.equal(String(preview.dto.projects[0].shortDescription || "").includes("Image:"), false);
    assert.equal(preview.dto.credentials[0].title, "Design prize");
    assert.equal(JSON.stringify(preview).includes("REG-RICH-SECRET"), false);

    await configRoute.PUT(authed("http://localhost:3000/api/student/website/config", richToken, "PUT", {
      username: richUsername,
      selectedTemplateId: "magicui-portfolio",
    }));
    const publishRes = await publishRoute.POST(authed("http://localhost:3000/api/student/website/publish", richToken, "POST"));
    assert.equal(publishRes.status, 200);
    const publicRes = await publicProfileRoute.GET(new Request(`http://localhost:3000/api/public/profile/${richUsername}`), {
      params: Promise.resolve({ username: richUsername }),
    });
    assert.equal(publicRes.status, 200);
    const publicData = await publicRes.json();
    assert.equal(publicData.dto.profile.headline, "Goods for studios");
    assert.equal(publicData.dto.credentials[0].title, "Design prize");
    assert.equal(JSON.stringify(publicData).includes("REG-RICH-SECRET"), false);
  });
});
