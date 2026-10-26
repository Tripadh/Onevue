/**
 * Domain identity profiles — auth, persistence, privacy, and regression checks.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}

process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;
if (process.env.NODE_ENV === "production") process.env.NODE_ENV = "test";

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
};

const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

let User;
let ProfessionalProfile;
let FreelancerProfile;
let CreatorProfile;
let BusinessProfile;
let StudentProfile;
let routes;
let studentRoute;
let dashboardRoute;
let projectPublicDomainProfile;

const createdUserIds = [];

describe("Domain identity profiles", { concurrency: 1 }, () => {
  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    ProfessionalProfile = require(path.join(projectRoot, "models", "ProfessionalProfile.ts")).default;
    FreelancerProfile = require(path.join(projectRoot, "models", "FreelancerProfile.ts")).default;
    CreatorProfile = require(path.join(projectRoot, "models", "CreatorProfile.ts")).default;
    BusinessProfile = require(path.join(projectRoot, "models", "BusinessProfile.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    routes = {
      professional: require(path.join(projectRoot, "app", "api", "professional", "profile", "route.ts")),
      freelancer: require(path.join(projectRoot, "app", "api", "freelancer", "profile", "route.ts")),
      creator: require(path.join(projectRoot, "app", "api", "creator", "profile", "route.ts")),
      business: require(path.join(projectRoot, "app", "api", "business", "profile", "route.ts")),
    };
    studentRoute = require(path.join(projectRoot, "app", "api", "student", "profile", "route.ts"));
    dashboardRoute = require(path.join(projectRoot, "app", "api", "dashboard", "[role]", "route.ts"));
    projectPublicDomainProfile = require(path.join(projectRoot, "lib", "domain-profile", "public-projection.ts")).projectPublicDomainProfile;
    await Promise.all([
      ProfessionalProfile.init(),
      FreelancerProfile.init(),
      CreatorProfile.init(),
      BusinessProfile.init(),
    ]);
  });

  after(async () => {
    const models = [ProfessionalProfile, FreelancerProfile, CreatorProfile, BusinessProfile, StudentProfile];
    if (createdUserIds.length) {
      await Promise.all(models.map((Model) => Model.deleteMany({ userId: { $in: createdUserIds } })));
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  });

  async function makeUser(identity) {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = await User.create({
      name: `${identity} ${stamp}`,
      email: `${identity}_${stamp}@example.com`,
      password: "hash",
      identity,
    });
    createdUserIds.push(user._id);
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);
    return { user, token };
  }

  function request(token, body) {
    const headers = new Map();
    if (token) headers.set("authorization", `Bearer ${token}`);
    headers.set("content-type", "application/json");
    return {
      method: body === undefined ? "GET" : "PUT",
      headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    };
  }

  function modelFor(identity) {
    return {
      professional: ProfessionalProfile,
      freelancer: FreelancerProfile,
      creator: CreatorProfile,
      business: BusinessProfile,
    }[identity];
  }

  test("missing, invalid, and expired tokens return 401", async () => {
    const missing = await routes.professional.GET(request(null));
    assert.equal(missing.status, 401);

    const invalid = await routes.freelancer.GET(request("not-a-token"));
    assert.equal(invalid.status, 401);

    const { user } = await makeUser("creator");
    const expired = jwt.sign(
      { id: user._id.toString(), email: user.email, exp: Math.floor(Date.now() / 1000) - 60 },
      jwtSecret
    );
    const expiredRes = await routes.creator.GET(request(expired));
    assert.equal(expiredRes.status, 401);
  });

  test("identity is enforced and client owner ids cannot reassign a profile", async () => {
    const professional = await makeUser("professional");
    const freelancer = await makeUser("freelancer");
    const outsider = await makeUser("business");

    const wrongIdentity = await routes.freelancer.GET(request(professional.token));
    assert.equal(wrongIdentity.status, 403);
    assert.equal(await FreelancerProfile.countDocuments({ userId: professional.user._id }), 0);

    const studentDenied = await studentRoute.GET(request(professional.token));
    assert.equal(studentDenied.status, 403);
    assert.equal(await StudentProfile.countDocuments({ userId: professional.user._id }), 0);

    const hijack = await routes.professional.PUT(request(professional.token, {
      userId: outsider.user._id.toString(),
      headline: "Taken over",
    }));
    assert.equal(hijack.status, 403);
    assert.equal(await ProfessionalProfile.countDocuments({ userId: outsider.user._id }), 0);

    const ownerOverride = await routes.freelancer.PUT(request(freelancer.token, {
      ownerId: professional.user._id.toString(),
      headline: "Nope",
    }));
    assert.equal(ownerOverride.status, 403);

    const invalidIdentity = await routes.professional.PUT(request(professional.token, { identity: "not-an-identity" }));
    assert.equal(invalidIdentity.status, 400);

    const dashboardInvalid = await dashboardRoute.GET(request(null), { params: Promise.resolve({ role: "admin" }) });
    assert.equal(dashboardInvalid.status, 400);

    const dashboardMismatch = await dashboardRoute.GET(request(professional.token), {
      params: Promise.resolve({ role: "student" }),
    });
    assert.equal(dashboardMismatch.status, 403);
  });

  test("GET initializes one profile and repeated calls do not duplicate it", async () => {
    const { user, token } = await makeUser("business");
    const responses = await Promise.all([
      routes.business.GET(request(token)),
      routes.business.GET(request(token)),
      routes.business.GET(request(token)),
    ]);
    for (const response of responses) assert.equal(response.status, 200);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.equal(bodies[0].profile.id, bodies[1].profile.id);
    assert.equal(bodies[1].profile.id, bodies[2].profile.id);
    assert.equal(await BusinessProfile.countDocuments({ userId: user._id }), 1);

    await assert.rejects(
      BusinessProfile.create({ userId: user._id, businessName: "Duplicate" }),
      (error) => error && error.code === 11000
    );
    assert.equal(await BusinessProfile.countDocuments({ userId: user._id }), 1);
  });

  test("professional updates persist, partial objects keep siblings, and invalid values do not write", async () => {
    const { user, token } = await makeUser("professional");
    const created = await routes.professional.PUT(request(token, {
      headline: "Staff engineer",
      skills: [{ id: "skill_go", name: "Go", proficiency: "Advanced", yearsExperience: 4 }],
      currentEmployment: {
        company: "Acme",
        jobTitle: "Engineer",
        employmentType: "full_time",
        achievements: ["Cut latency 30%"],
      },
      contact: { email: "ada@acme.test", phone: "+1 555 0100", city: "Austin" },
    }));
    assert.equal(created.status, 200);

    const partial = await routes.professional.PUT(request(token, {
      currentEmployment: { jobTitle: "Staff Engineer" },
      contact: { email: "ada.lovelace@acme.test" },
    }));
    assert.equal(partial.status, 200);

    const fresh = await ProfessionalProfile.findOne({ userId: user._id });
    assert.equal(fresh.headline, "Staff engineer");
    assert.equal(fresh.skills.length, 1);
    assert.equal(fresh.skills[0].id, "skill_go");
    assert.equal(fresh.skills[0].name, "Go");
    assert.equal(fresh.currentEmployment.company, "Acme");
    assert.equal(fresh.currentEmployment.jobTitle, "Staff Engineer");
    assert.deepEqual(fresh.currentEmployment.achievements, ["Cut latency 30%"]);
    assert.equal(fresh.contact.email, "ada.lovelace@acme.test");
    assert.equal(fresh.contact.phone, "+1 555 0100");
    assert.equal(fresh.contact.city, "Austin");

    const invalid = await routes.professional.PUT(request(token, {
      headline: "Should not stick",
      currentEmployment: { startDate: "2024-13-40", employmentType: "king" },
      portfolio: [{ id: "p1", title: "Demo", url: "javascript:alert(1)" }],
    }));
    assert.equal(invalid.status, 400);
    const unchanged = await ProfessionalProfile.findOne({ userId: user._id });
    assert.equal(unchanged.headline, "Staff engineer");
    assert.equal(unchanged.portfolio.length, 0);

    const unsupported = await routes.professional.PUT(request(token, { isAdmin: true }));
    assert.equal(unsupported.status, 400);
    const operator = await routes.professional.PUT(request(token, { $set: { headline: "injected" } }));
    assert.equal(operator.status, 400);
    const malformed = await routes.professional.PUT(request(token, new Error("bad json")));
    assert.equal(malformed.status, 400);

    const again = await routes.professional.PUT(request(token, { bio: "Keeps one row" }));
    assert.equal(again.status, 200);
    assert.equal(await ProfessionalProfile.countDocuments({ userId: user._id }), 1);
  });

  test("freelancer validation rejects bad rates, urls, and verified testimonial spoofing", async () => {
    const { user, token } = await makeUser("freelancer");
    const badRate = await routes.freelancer.PUT(request(token, {
      services: [{ id: "svc_1", name: "Audit", pricingModel: "hourly", rateMin: 200, rateMax: 40, deliveryDays: 3 }],
    }));
    assert.equal(badRate.status, 400);

    const badDays = await routes.freelancer.PUT(request(token, {
      services: [{ id: "svc_1", name: "Audit", pricingModel: "hourly", deliveryDays: -2 }],
    }));
    assert.equal(badDays.status, 400);

    const badUrl = await routes.freelancer.PUT(request(token, {
      workSamples: [{ id: "sample_1", title: "Reel", url: "javascript:alert(1)", mediaType: "link" }],
    }));
    assert.equal(badUrl.status, 400);

    const spoof = await routes.freelancer.PUT(request(token, {
      testimonials: [{ id: "quote_1", quote: "Excellent", authorName: "Jamie", attribution: "verified" }],
    }));
    assert.equal(spoof.status, 400);

    const saved = await routes.freelancer.PUT(request(token, {
      headline: "Product designer",
      services: [{ id: "svc_1", name: "Audit", pricingModel: "fixed", currency: "usd", rateMin: 500, rateMax: 1200, deliveryDays: 10 }],
      testimonials: [{ id: "quote_1", quote: "Excellent", authorName: "Jamie", relationship: "Client" }],
    }));
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.profile.testimonials[0].attribution, "self-reported");
    assert.equal(body.profile.services[0].currency, "USD");

    const fresh = await FreelancerProfile.findOne({ userId: user._id });
    assert.equal(fresh.testimonials[0].id, "quote_1");
    assert.equal(fresh.services[0].rateMin, 500);
    const projected = projectPublicDomainProfile(fresh.toObject());
    assert.equal(projected.published, false);
    assert.equal(projected.testimonials[0].independentlyVerified, false);
    assert.equal(projected.userId, undefined);
  });

  test("creator audience numbers cannot be marked verified by the client", async () => {
    const { user, token } = await makeUser("creator");
    const spoof = await routes.creator.PUT(request(token, {
      audienceStats: [{
        id: "aud_1",
        platform: "YouTube",
        metric: "followers",
        value: 150000,
        source: "self_reported",
        measuredAt: "2024-05-01",
        verificationStatus: "verified",
      }],
    }));
    assert.equal(spoof.status, 400);

    const badEngagement = await routes.creator.PUT(request(token, {
      audienceStats: [{
        id: "aud_2",
        platform: "Newsletter",
        metric: "engagement_rate",
        value: 140,
        source: "manual",
        measuredAt: "2024-06-01",
      }],
    }));
    assert.equal(badEngagement.status, 400);

    const saved = await routes.creator.PUT(request(token, {
      niche: "Developer tools",
      audienceStats: [{
        id: "aud_1",
        platform: "YouTube",
        metric: "followers",
        value: 150000,
        source: "self_reported",
        measuredAt: "2024-05-01",
      }],
    }));
    assert.equal(saved.status, 200);
    const fresh = await CreatorProfile.findOne({ userId: user._id });
    assert.equal(fresh.audienceStats[0].verificationStatus, "self-reported");
    const projected = projectPublicDomainProfile(fresh.toObject());
    assert.equal(projected.audienceStats[0].independentlyVerified, false);
    assert.equal(projected.audienceStats[0].verificationStatus, "self-reported");
  });

  test("business private registration data is stored for the owner and removed from the public projection", async () => {
    const { user, token } = await makeUser("business");
    const saved = await routes.business.PUT(request(token, {
      businessName: "Northwind",
      registration: {
        legalName: "Northwind LLC",
        registrationNumber: "REG-PRIVATE-9",
        documentStorageKey: "business/reg/northwind.pdf",
        status: "pending",
      },
      location: { city: "Austin", addressLine: "1 Secret Street" },
      publicContact: { email: "hello@northwind.test", phone: "+1 555 0199", visibility: { email: "private", phone: "public" } },
      team: [
        { id: "team_public", name: "Ada", role: "CEO", isPublic: true },
        { id: "team_private", name: "Grace", role: "Counsel", isPublic: false },
      ],
      resources: [
        { id: "res_private", title: "Internal deck", url: "https://example.com/deck", visibility: "private" },
        { id: "res_public", title: "Overview", url: "https://example.com/overview", visibility: "public" },
      ],
    }));
    assert.equal(saved.status, 200);
    const owner = await saved.json();
    assert.equal(owner.profile.registration.documentStorageKey, "business/reg/northwind.pdf");
    assert.equal(owner.profile.registration.registrationNumber, "REG-PRIVATE-9");
    assert.equal(owner.profile.registration.status, "pending");
    assert.equal(owner.profile.team.length, 2);

    const spoof = await routes.business.PUT(request(token, { registration: { status: "verified" } }));
    assert.equal(spoof.status, 400);
    const fresh = await BusinessProfile.findOne({ userId: user._id });
    assert.equal(fresh.registration.status, "pending");

    const projected = projectPublicDomainProfile(fresh.toObject());
    assert.equal(projected.published, false);
    assert.equal(projected.registration.documentStorageKey, undefined);
    assert.equal(projected.registration.registrationNumber, undefined);
    assert.equal(projected.location.addressLine, undefined);
    assert.equal(projected.location.city, "Austin");
    assert.equal(projected.publicContact.email, undefined);
    assert.equal(projected.publicContact.phone, "+1 555 0199");
    assert.equal(projected.team.length, 1);
    assert.equal(projected.team[0].name, "Ada");
    assert.equal(projected.resources.length, 1);
    assert.equal(projected.resources[0].title, "Overview");
    assert.equal(projected.userId, undefined);
  });

  test("server-managed verification on an existing certification is preserved", async () => {
    const { user, token } = await makeUser("professional");
    const saved = await routes.professional.PUT(request(token, {
      certifications: [{ id: "cert_aws", title: "AWS Solutions Architect", issuer: "Amazon" }],
    }));
    assert.equal(saved.status, 200);
    await ProfessionalProfile.updateOne(
      { userId: user._id, "certifications.id": "cert_aws" },
      { $set: { "certifications.$.verificationStatus": "verified" } }
    );
    const attempted = await routes.professional.PUT(request(token, {
      certifications: [{ id: "cert_aws", title: "AWS Solutions Architect", issuer: "Amazon", verificationStatus: "self-reported" }],
    }));
    assert.equal(attempted.status, 400);
    const kept = await routes.professional.PUT(request(token, {
      certifications: [{ id: "cert_aws", title: "AWS Solutions Architect", issuer: "Amazon Web Services" }],
    }));
    assert.equal(kept.status, 200);
    const fresh = await ProfessionalProfile.findOne({ userId: user._id });
    assert.equal(fresh.certifications[0].issuer, "Amazon Web Services");
    assert.equal(fresh.certifications[0].verificationStatus, "verified");
    assert.equal(fresh.certifications[0].id, "cert_aws");
  });

  test("duplicate record ids are rejected", async () => {
    const { token } = await makeUser("creator");
    const response = await routes.creator.PUT(request(token, {
      channels: [
        { id: "same", platform: "YouTube", url: "https://youtube.com/@one" },
        { id: "same", platform: "Vimeo", url: "https://vimeo.com/one" },
      ],
    }));
    assert.equal(response.status, 400);
  });

  test("additive identity fields persist without replacing unrelated sections", async () => {
    const websiteSource = require(path.join(projectRoot, "lib", "domain-profile", "website-source.ts"));

    const professional = await makeUser("professional");
    const savedProfessional = await routes.professional.PUT(request(professional.token, {
      headline: "Engineer",
      userId: professional.user._id.toString(),
      currentEmployment: { company: "Acme", jobTitle: "Engineer", achievements: ["Role result"] },
      achievements: [{ id: "ach_1", title: "Talk", organization: "Conf", date: "2024-04-01", evidenceUrl: "https://example.com/talk" }],
      socialLinks: [{ id: "soc_1", platform: "GitHub", url: "https://github.com/ada", label: "Code" }],
      contact: { linkedin: "https://www.linkedin.com/in/ada", website: "https://ada.example" },
    }));
    assert.equal(savedProfessional.status, 200);
    const professionalBody = await savedProfessional.json();
    assert.equal(professionalBody.profile.achievements[0].id, "ach_1");
    assert.equal(professionalBody.profile.socialLinks[0].label, "Code");
    assert.equal(String(professionalBody.profile.userId), professional.user._id.toString());
    assert.equal(await ProfessionalProfile.countDocuments({ userId: professional.user._id }), 1);

    const roleOnly = await routes.professional.PUT(request(professional.token, {
      currentEmployment: { achievements: ["Role result", "Second"] },
    }));
    assert.equal(roleOnly.status, 200);
    const professionalDoc = await ProfessionalProfile.findOne({ userId: professional.user._id });
    assert.equal(professionalDoc.achievements[0].title, "Talk");
    assert.deepEqual(professionalDoc.currentEmployment.achievements, ["Role result", "Second"]);
    assert.equal(professionalDoc.socialLinks[0].url, "https://github.com/ada");
    assert.equal(professionalDoc.contact.linkedin, "https://www.linkedin.com/in/ada");

    const badLink = await routes.professional.PUT(request(professional.token, {
      socialLinks: [{ id: "soc_2", platform: "X", url: "javascript:alert(1)" }],
    }));
    assert.equal(badLink.status, 400);
    assert.equal((await ProfessionalProfile.findOne({ userId: professional.user._id })).socialLinks.length, 1);

    const legacyProfessional = await routes.professional.PUT(request(professional.token, { headline: "Still valid" }));
    assert.equal(legacyProfessional.status, 200);

    const emptyProfessional = websiteSource.domainProfileToPublicSource("professional", {
      headline: "Engineer",
      currentEmployment: { jobTitle: "Engineer", company: "Acme" },
    });
    assert.deepEqual(emptyProfessional.achievements.map((item) => item.title), ["Engineer at Acme"]);
    assert.deepEqual(emptyProfessional.links, []);
    const fullProfessional = websiteSource.domainProfileToPublicSource("professional", professionalDoc.toObject());
    assert.ok(fullProfessional.achievements.some((item) => item.title === "Talk"));
    assert.equal(fullProfessional.links[0].url, "https://github.com/ada");

    const freelancer = await makeUser("freelancer");
    const savedFreelancer = await routes.freelancer.PUT(request(freelancer.token, {
      availability: "limited",
      engagementTypes: ["hourly", "retainer"],
      services: [{
        id: "svc_1",
        name: "Audit",
        pricingModel: "hourly",
        currency: "USD",
        rateMin: 50,
        rateMax: 90,
        packages: [{ id: "pkg_1", name: "Starter", price: 400, currency: "USD", features: ["Report"] }],
      }],
      workExperience: [{ id: "job_1", company: "Acme", jobTitle: "Designer", startDate: "2022-01-01", isCurrent: true }],
    }));
    assert.equal(savedFreelancer.status, 200);
    const freelancerBody = await savedFreelancer.json();
    assert.deepEqual(freelancerBody.profile.engagementTypes, ["hourly", "retainer"]);
    assert.equal(freelancerBody.profile.services[0].packages[0].price, 400);
    assert.equal(freelancerBody.profile.availability, "limited");

    const keptPackage = await routes.freelancer.PUT(request(freelancer.token, {
      services: [{ id: "svc_1", name: "Audit renamed" }],
    }));
    assert.equal(keptPackage.status, 200);
    const freelancerDoc = await FreelancerProfile.findOne({ userId: freelancer.user._id });
    assert.equal(freelancerDoc.services[0].name, "Audit renamed");
    assert.equal(freelancerDoc.services[0].packages[0].id, "pkg_1");
    assert.equal(freelancerDoc.services[0].rateMin, 50);
    assert.equal(freelancerDoc.workExperience[0].company, "Acme");
    assert.equal(freelancerDoc.availability, "limited");

    const badEngagement = await routes.freelancer.PUT(request(freelancer.token, { engagementTypes: ["forever"] }));
    assert.equal(badEngagement.status, 400);
    const badExperience = await routes.freelancer.PUT(request(freelancer.token, {
      workExperience: [{ id: "job_2", company: "Acme", jobTitle: "Lead", startDate: "2024-02-01", endDate: "2024-01-01" }],
    }));
    assert.equal(badExperience.status, 400);
    const currentWithEnd = await routes.freelancer.PUT(request(freelancer.token, {
      workExperience: [{ id: "job_2", company: "Acme", jobTitle: "Lead", isCurrent: true, endDate: "2024-06-01" }],
    }));
    assert.equal(currentWithEnd.status, 400);
    const packageWithoutCurrency = await routes.freelancer.PUT(request(freelancer.token, {
      services: [{ id: "svc_1", name: "Audit renamed", packages: [{ id: "pkg_2", name: "Quoted", price: 10 }] }],
    }));
    assert.equal(packageWithoutCurrency.status, 400);
    assert.equal((await FreelancerProfile.findOne({ userId: freelancer.user._id })).services[0].packages[0].id, "pkg_1");

    const creator = await makeUser("creator");
    const savedCreator = await routes.creator.PUT(request(creator.token, {
      displayName: "Ada Essays",
      headline: "Long-form reporting",
      niche: "Writing",
      bio: "Original bio",
      collaboration: { openToCollab: true, preferences: "Editorial", brandSafetyNotes: "No politics" },
      featuredContent: [{ id: "feat_1", title: "Film", url: "https://video.example/film", thumbnailUrl: "https://cdn.example/film.jpg" }],
      pastCollaborations: [{ id: "col_1", organization: "Northwind", title: "Spring drop", outcome: "Self-reported launch" }],
    }));
    assert.equal(savedCreator.status, 200);
    const creatorBody = await savedCreator.json();
    assert.equal(creatorBody.profile.displayName, "Ada Essays");
    assert.equal(creatorBody.profile.featuredContent[0].thumbnailUrl, "https://cdn.example/film.jpg");
    assert.equal(creatorBody.profile.collaboration.openToCollab, true);

    const preferencesOnly = await routes.creator.PUT(request(creator.token, {
      collaboration: { preferences: "Updated preferences" },
    }));
    assert.equal(preferencesOnly.status, 200);
    const creatorDoc = await CreatorProfile.findOne({ userId: creator.user._id });
    assert.equal(creatorDoc.displayName, "Ada Essays");
    assert.equal(creatorDoc.niche, "Writing");
    assert.equal(creatorDoc.collaboration.openToCollab, true);
    assert.equal(creatorDoc.collaboration.preferences, "Updated preferences");
    assert.equal(creatorDoc.collaboration.brandSafetyNotes, "No politics");
    assert.equal(creatorDoc.pastCollaborations[0].organization, "Northwind");

    const badThumb = await routes.creator.PUT(request(creator.token, {
      featuredContent: [{ id: "feat_1", title: "Film", url: "https://video.example/film", thumbnailUrl: "javascript:alert(1)" }],
    }));
    assert.equal(badThumb.status, 400);
    const oldFeatured = await routes.creator.PUT(request(creator.token, {
      featuredContent: [{ id: "feat_2", title: "Essay", url: "https://ada.example/essay" }],
    }));
    assert.equal(oldFeatured.status, 200);
    const creatorSource = websiteSource.domainProfileToPublicSource("creator", { niche: "Writing", bio: "Original bio" });
    assert.equal(creatorSource.headline, "Writing");
    assert.equal(creatorSource.preferredName, undefined);

    const business = await makeUser("business");
    const savedBusiness = await routes.business.PUT(request(business.token, {
      businessName: "Northwind",
      mission: "Make useful tools",
      tagline: "Tools for studios",
      foundedYear: 2014,
      businessModel: "b2b",
      targetCustomers: ["Studios"],
      products: [{ id: "prod_1", name: "Lamp", description: "A lamp", price: 80, currency: "USD", imageUrl: "https://cdn.example/lamp.jpg" }],
      credentials: [{ id: "cred_1", recordType: "award", title: "Design prize", issuer: "Museum", issueDate: "2023-01-01" }],
      registration: { registrationNumber: "REG-SECRET" },
    }));
    assert.equal(savedBusiness.status, 200);
    const businessBody = await savedBusiness.json();
    assert.equal(businessBody.profile.credentials[0].verificationStatus, "self-reported");
    assert.equal(businessBody.profile.foundedYear, 2014);
    assert.equal(businessBody.profile.mission, "Make useful tools");

    const missionOnly = await routes.business.PUT(request(business.token, { mission: "Updated mission" }));
    assert.equal(missionOnly.status, 200);
    const businessDoc = await BusinessProfile.findOne({ userId: business.user._id });
    assert.equal(businessDoc.mission, "Updated mission");
    assert.equal(businessDoc.tagline, "Tools for studios");
    assert.equal(businessDoc.foundedYear, 2014);
    assert.equal(businessDoc.products[0].price, 80);
    assert.equal(businessDoc.registration.registrationNumber, "REG-SECRET");

    const futureYear = await routes.business.PUT(request(business.token, { foundedYear: 2999 }));
    assert.equal(futureYear.status, 400);
    const quoteProduct = await routes.business.PUT(request(business.token, {
      products: [{ id: "prod_2", name: "Custom", description: "Quoted on request" }],
    }));
    assert.equal(quoteProduct.status, 200);
    const pricedWithoutCurrency = await routes.business.PUT(request(business.token, {
      products: [{ id: "prod_3", name: "Chair", price: 20 }],
    }));
    assert.equal(pricedWithoutCurrency.status, 400);
    const spoofedCredential = await routes.business.PUT(request(business.token, {
      credentials: [{ id: "cred_2", title: "ISO", verificationStatus: "verified" }],
    }));
    assert.equal(spoofedCredential.status, 400);
    assert.equal((await BusinessProfile.findOne({ userId: business.user._id })).credentials[0].verificationStatus, "self-reported");
    assert.equal((await BusinessProfile.findOne({ userId: business.user._id })).foundedYear, 2014);

    const oldBusiness = websiteSource.domainProfileToPublicSource("business", {
      businessName: "Northwind",
      industry: "Design",
      organizationType: "studio",
      mission: "Make useful tools",
    });
    assert.equal(oldBusiness.headline.includes("Tools for studios"), false);
    assert.equal(oldBusiness.credentials.length, 0);
    const newBusiness = websiteSource.domainProfileToPublicSource("business", businessDoc.toObject());
    assert.equal(newBusiness.headline, "Tools for studios");
    assert.match(newBusiness.bio, /2014/);
    assert.equal(newBusiness.credentials[0].credentialType, "other");
    assert.match(newBusiness.projects[0].shortDescription, /Image: https:\/\/cdn.example\/lamp.jpg/);
  });
});
