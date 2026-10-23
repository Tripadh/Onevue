/**
 * Applying a stored resume review. The extractor is mocked.
 * This file does not read environment files or call a live LLM provider.
 */

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.resolve(__dirname, "..");
const { MongoMemoryServer } = require(path.join(
  projectRoot,
  "certificate-verification",
  "node_modules",
  "mongodb-memory-server",
));

const ts = require(path.join(projectRoot, "node_modules", "typescript"));
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

function extraction(overrides = {}) {
  return {
    status: "ok",
    schemaVersion: "1.0.0",
    data: {
      profile: {
        name: "Ada Lovelace",
        headline: "Student engineer",
        email: "ada@example.com",
        phone: null,
        location: "London",
        summary: "Builds tools.",
      },
      education: [{
        institution: "Example University",
        degree: "BSc",
        fieldOfStudy: "Mathematics",
        startDate: "2018",
        endDate: "2022",
        grade: "85%",
      }],
      experience: [{
        company: "Analytical Engines",
        title: "Intern",
        location: null,
        startDate: null,
        endDate: null,
        isCurrent: false,
        bullets: [],
      }],
      skills: [{ name: "Analysis" }],
      projects: [{
        name: "Notes",
        description: "A notebook",
        technologies: ["Ink"],
        links: ["https://github.com/ada/notes"],
      }],
      achievements: [
        { title: "Security certificate", description: "Claimed on the resume" },
        { title: "Hackathon prize", description: "First place" },
      ],
      socialLinks: [{ platform: "github", url: "https://github.com/ada" }],
    },
    fieldMeta: {},
    warnings: [],
    meta: {
      schemaVersion: "1.0.0",
      provider: "mock",
      fallbackUsed: false,
      latencyMs: 1,
      mock: true,
    },
    ...overrides,
  };
}

function upload(token) {
  const form = new FormData();
  form.append("file", new File([PDF], "resume.pdf", { type: "application/pdf" }));
  return new Request("http://127.0.0.1/api/student/resume/extract", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

function applyRequest(token, body) {
  return new Request("http://127.0.0.1/api/student/resume/apply", {
    method: "POST",
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("resume review application", () => {
  let memory;
  let mongoose;
  let User;
  let StudentProfile;
  let tokenA;
  let tokenB;
  let userA;
  let extractStudentResume;
  let applyStudentResume;
  let readStudentResumeReview;
  let clearResumeReviewsForTests;
  const jwtSecret = "resume-apply-test-secret";

  before(async () => {
    memory = await MongoMemoryServer.create();
    process.env.MONGODB_URI = memory.getUri();
    process.env.JWT_SECRET = jwtSecret;
    delete process.env.LLM_SERVICE_URL;
    delete process.env.LLM_SERVICE_API_KEY;

    mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
    const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));
    await mongoose.connect(process.env.MONGODB_URI);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    extractStudentResume = require(path.join(projectRoot, "lib", "resume-extract.ts")).extractStudentResume;
    applyStudentResume = require(path.join(projectRoot, "lib", "resume-apply.ts")).applyStudentResume;
    readStudentResumeReview = require(path.join(projectRoot, "lib", "resume-extract.ts")).readStudentResumeReview;
    clearResumeReviewsForTests = require(path.join(projectRoot, "lib", "resume-review.ts")).clearResumeReviewsForTests;

    const stamp = Date.now();
    userA = await User.create({
      name: `Apply A ${stamp}`,
      email: `apply_a_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const userB = await User.create({
      name: `Apply B ${stamp}`,
      email: `apply_b_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    tokenA = jwt.sign({ id: userA._id.toString(), email: userA.email }, jwtSecret);
    tokenB = jwt.sign({ id: userB._id.toString(), email: userB.email }, jwtSecret);
    await StudentProfile.create({
      userId: userA._id,
      headline: "Original headline",
      education: [{
        institution: "Kept University",
        degree: "BA",
        fieldOfStudy: "History",
        verificationStatus: "verified",
      }],
      projects: [{ title: "Kept Project", shortDescription: "Stay" }],
      skills: [{ name: "Existing Skill", category: "Tools", proficiency: "Beginner" }],
      achievements: [{
        title: "Kept Award",
        category: "award",
        description: "Stay",
        verificationStatus: "self-reported",
      }],
      credentials: [{
        title: "Issued Badge",
        issuer: "Credly",
        credentialType: "badge",
        verificationStatus: "verified",
        certificateVerificationId: "issuer-record",
      }],
    });
    await StudentProfile.create({ userId: userB._id });
  });

  after(async () => {
    clearResumeReviewsForTests();
    await mongoose.disconnect();
    await memory.stop();
  });

  beforeEach(async () => {
    clearResumeReviewsForTests();
    await StudentProfile.updateOne(
      { userId: userA._id },
      {
        $set: {
          headline: "Original headline",
          bio: "",
          education: [{
            institution: "Kept University",
            degree: "BA",
            fieldOfStudy: "History",
            verificationStatus: "verified",
          }],
          projects: [{ title: "Kept Project", shortDescription: "Stay" }],
          skills: [{ name: "Existing Skill", category: "Tools", proficiency: "Beginner" }],
          achievements: [{
            title: "Kept Award",
            category: "award",
            description: "Stay",
            verificationStatus: "self-reported",
          }],
          credentials: [{
            title: "Issued Badge",
            issuer: "Credly",
            credentialType: "badge",
            verificationStatus: "verified",
            certificateVerificationId: "issuer-record",
          }],
          links: [],
          contacts: { email: "", phone: "" },
        },
      },
    );
  });

  async function reviewFrom(payload = extraction()) {
    const response = await extractStudentResume(upload(tokenA), {
      extract: async () => payload,
      config: { baseUrl: "http://127.0.0.1", apiKey: "not-used" },
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  test("applies selected fields and preserves unselected profile data", async () => {
    const review = await reviewFrom();
    const response = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [
        { section: "education", index: 0, fields: ["institution", "degree", "fieldOfStudy"] },
        { section: "projects", index: 0, fields: ["name", "description", "technologies", "links"] },
        { section: "skills", index: 0, fields: ["name"], category: "Tools", proficiency: "Intermediate" },
        { section: "achievements", index: 0, fields: ["title", "description"] },
        { section: "socialLinks", index: 0, fields: ["platform", "url"] },
      ],
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.applied, true);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    const user = await User.findById(userA._id).lean();
    assert.equal(user.name, userA.name);
    assert.equal(profile.headline, "Original headline");
    assert.equal(profile.education.length, 2);
    assert.equal(profile.education[0].institution, "Kept University");
    assert.equal(profile.education[0].verificationStatus, "verified");
    assert.equal(profile.education[1].institution, "Example University");
    assert.equal(profile.education[1].verificationStatus, "self-reported");
    assert.equal(profile.projects.length, 2);
    assert.equal(profile.projects[0].title, "Kept Project");
    assert.equal(profile.projects[1].repoUrl, "https://github.com/ada/notes");
    assert.equal(profile.skills.length, 2);
    assert.equal(profile.skills[1].name, "Analysis");
    assert.equal(profile.skills[1].category, "Tools");
    assert.equal(profile.achievements.length, 2);
    assert.equal(profile.achievements[0].title, "Kept Award");
    assert.equal(profile.links.length, 1);
    assert.equal(profile.links[0].verificationStatus, "unverified");
    assert.equal(profile.credentials.length, 1);
    assert.equal(profile.credentials[0].verificationStatus, "verified");
    const gone = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(gone.status, 404);
  });

  test("does not duplicate an education record that already matches", async () => {
    const payload = extraction();
    payload.data.education = [{
      institution: "Kept University",
      degree: "BA",
      fieldOfStudy: "History",
      startDate: null,
      endDate: null,
      grade: null,
    }];
    const review = await reviewFrom(payload);
    const response = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree", "fieldOfStudy"] }],
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.skipped.length, 1);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.education.length, 1);
    assert.equal(profile.education[0].verificationStatus, "verified");
  });

  test("rejects invalid selections and client-supplied values", async () => {
    const review = await reviewFrom();
    const invalidSection = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "experience", index: 0, fields: ["company"] }],
    }));
    assert.equal(invalidSection.status, 400);
    const invalidIndex = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 4, fields: ["institution"] }],
    }));
    assert.equal(invalidIndex.status, 400);
    const invalidField = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "nickname"] }],
    }));
    assert.equal(invalidField.status, 400);
    const override = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{
        section: "education",
        index: 0,
        fields: ["institution", "degree"],
        value: "Client invented university",
      }],
    }));
    assert.equal(override.status, 400);
    const forgedStatus = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      verificationStatus: "verified",
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(forgedStatus.status, 400);
    const forgedId = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{
        section: "credentials",
        index: 0,
        fields: ["title"],
        issuer: "Amazon",
        certificateVerificationId: "forged",
      }],
    }));
    assert.equal(forgedId.status, 400);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.education.length, 1);
    const stillThere = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(stillThere.status, 200);
  });

  test("rejects another student, an expired review, and a missing token", async () => {
    const review = await reviewFrom();
    const foreign = await applyStudentResume(applyRequest(tokenB, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(foreign.status, 404);
    const anonymous = await applyStudentResume(applyRequest("", {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(anonymous.status, 401);
    const expiredReview = await extractStudentResume(upload(tokenA), {
      extract: async () => extraction(),
      config: { baseUrl: "http://127.0.0.1", apiKey: "not-used" },
      ttlMs: 1,
    });
    const expiredId = (await expiredReview.json()).reviewId;
    const expired = await applyStudentResume(applyRequest(tokenA, {
      reviewId: expiredId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }), Date.now() + 50);
    assert.equal(expired.status, 404);
  });

  test("keeps resume credentials self-reported and does not replace a verified credential", async () => {
    const payload = extraction();
    payload.data.achievements = [
      { title: "Issued Badge", description: "Replace the verified badge" },
      { title: "Resume certificate", description: "A claim" },
    ];
    const next = await reviewFrom(payload);
    const conflict = await applyStudentResume(applyRequest(tokenA, {
      reviewId: next.reviewId,
      selections: [{ section: "credentials", index: 0, fields: ["title"], issuer: "Someone" }],
    }));
    assert.equal(conflict.status, 409);
    const added = await applyStudentResume(applyRequest(tokenA, {
      reviewId: next.reviewId,
      selections: [{ section: "credentials", index: 1, fields: ["title", "description"], issuer: "Example Org" }],
    }));
    assert.equal(added.status, 200);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    const verified = profile.credentials.find((item) => item.title === "Issued Badge");
    const claim = profile.credentials.find((item) => item.title === "Resume certificate");
    assert.equal(verified.verificationStatus, "verified");
    assert.equal(verified.certificateVerificationId, "issuer-record");
    assert.equal(claim.verificationStatus, "self-reported");
    assert.equal(claim.certificateVerificationId, "");
    assert.equal(JSON.stringify(claim).includes("forged"), false);
  });

  test("requires a skill category and proficiency", async () => {
    const review = await reviewFrom();
    const missing = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "skills", index: 0, fields: ["name"] }],
    }));
    assert.equal(missing.status, 400);
    const saved = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "skills", index: 0, fields: ["name"], category: "AI / ML", proficiency: "Advanced" }],
    }));
    assert.equal(saved.status, 200);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    const skill = profile.skills.find((item) => item.name === "Analysis");
    assert.equal(skill.category, "AI / ML");
    assert.equal(skill.proficiency, "Advanced");
    assert.equal(profile.skills.some((item) => item.name === "Existing Skill"), true);
  });

  test("returns 409 when the selected section changed after the review", async () => {
    const review = await reviewFrom();
    await StudentProfile.updateOne(
      { userId: userA._id },
      { $set: { "education.0.fieldOfStudy": "Changed after review" } },
    );
    const response = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(response.status, 409);
    const stillThere = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(stillThere.status, 200);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.education[0].fieldOfStudy, "Changed after review");
    assert.equal(profile.education.some((item) => item.institution === "Example University"), false);
  });

  test("extracts with a mocked PDF without changing the profile, then applies only the selected field", async () => {
    const before = await StudentProfile.findOne({ userId: userA._id }).lean();
    const review = await reviewFrom();
    const afterExtract = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(afterExtract.headline, before.headline);
    assert.equal(afterExtract.bio, before.bio);
    assert.equal(afterExtract.education.length, before.education.length);
    assert.equal(afterExtract.projects.length, before.projects.length);
    assert.equal(afterExtract.skills.length, before.skills.length);
    assert.equal(afterExtract.achievements.length, before.achievements.length);
    assert.equal(afterExtract.credentials.length, before.credentials.length);
    assert.equal(afterExtract.links.length, before.links.length);
    assert.equal(afterExtract.contacts.email, before.contacts.email);
    assert.equal(afterExtract.credentials[0].verificationStatus, "verified");
    assert.equal(afterExtract.credentials[0].certificateVerificationId, "issuer-record");

    const response = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "profile", index: 0, fields: ["summary"] }],
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.applied, true);
    const after = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(after.bio, "Builds tools.");
    assert.equal(after.headline, before.headline);
    assert.equal(after.education.length, before.education.length);
    assert.equal(after.education[0].institution, "Kept University");
    assert.equal(after.education[0].verificationStatus, "verified");
    assert.equal(after.projects.length, before.projects.length);
    assert.equal(after.skills.length, before.skills.length);
    assert.equal(after.achievements.length, before.achievements.length);
    assert.equal(after.credentials.length, before.credentials.length);
    assert.equal(after.credentials[0].certificateVerificationId, "issuer-record");
    assert.equal(after.links.length, before.links.length);
    assert.equal(after.contacts.email, "");
    assert.equal(after.contacts.phone, "");
  });

  test("a missing review after a restart returns a clear error and extraction can be retried", async () => {
    const review = await reviewFrom();
    clearResumeReviewsForTests();
    const missing = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "profile", index: 0, fields: ["summary"] }],
    }));
    const missingBody = await missing.json();
    assert.equal(missing.status, 404);
    assert.match(missingBody.message, /Choose the PDF again/);
    assert.match(missingBody.message, /disappear when the server restarts/);
    const expiredRead = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(expiredRead.status, 404);
    const retry = await reviewFrom();
    assert.equal(typeof retry.reviewId, "string");
    assert.notEqual(retry.reviewId, review.reviewId);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.headline, "Original headline");
    assert.equal(profile.bio, "");
  });

  test("does not apply one review twice under concurrent requests", async () => {
    const review = await reviewFrom();
    const body = {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree", "grade"] }],
    };
    const [first, second] = await Promise.all([
      applyStudentResume(applyRequest(tokenA, body)),
      applyStudentResume(applyRequest(tokenA, body)),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.equal(statuses[0], 200);
    assert.equal(statuses[1] === 404 || statuses[1] === 409, true);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    const added = profile.education.filter((item) => item.institution === "Example University");
    assert.equal(added.length, 1);
    assert.equal(added[0].percentage, "85%");
    assert.equal(profile.education[0].institution, "Kept University");
  });

  test("a conflicting field does not write other selected sections and leaves the review usable", async () => {
    const review = await reviewFrom();
    const response = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [
        { section: "profile", index: 0, fields: ["headline", "summary"] },
        { section: "education", index: 0, fields: ["institution", "degree"] },
      ],
    }));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.match(body.message, /headline/);
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.headline, "Original headline");
    assert.equal(profile.bio, "");
    assert.equal(profile.education.length, 1);
    assert.equal(profile.education[0].institution, "Kept University");
    const stillThere = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(stillThere.status, 200);
    const retry = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "profile", index: 0, fields: ["summary"] }],
    }));
    assert.equal(retry.status, 200);
    const after = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(after.bio, "Builds tools.");
    assert.equal(after.headline, "Original headline");
    assert.equal(after.education.length, 1);
  });

  test("a failed profile write does not consume the review", async () => {
    const review = await reviewFrom();
    const original = StudentProfile.findOneAndUpdate;
    StudentProfile.findOneAndUpdate = async function failWrite() {
      const error = new Error("database unavailable");
      error.name = "MongoServerError";
      throw error;
    };
    try {
      const response = await applyStudentResume(applyRequest(tokenA, {
        reviewId: review.reviewId,
        selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
      }));
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.match(body.message, /could not be applied/);
    } finally {
      StudentProfile.findOneAndUpdate = original;
    }
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(profile.education.length, 1);
    const stillThere = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(stillThere.status, 200);
    const retry = await applyStudentResume(applyRequest(tokenA, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(retry.status, 200);
    const after = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(after.education.length, 2);
    assert.equal(after.education[0].institution, "Kept University");
  });

  test("an overlapping apply is rejected while the first write is in progress", async () => {
    const review = await reviewFrom();
    const original = StudentProfile.findOneAndUpdate;
    let calls = 0;
    let releaseGate;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    StudentProfile.findOneAndUpdate = function gatedWrite(...args) {
      calls += 1;
      return gate.then(() => original.apply(this, args));
    };
    const body = {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree", "grade"] }],
    };
    const first = applyStudentResume(applyRequest(tokenA, body));
    try {
      for (let attempt = 0; attempt < 50 && calls === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(calls, 1);
      const second = await applyStudentResume(applyRequest(tokenA, body));
      const secondBody = await second.json();
      assert.equal(second.status, 409);
      assert.match(secondBody.message, /already being applied/);
      releaseGate();
      const firstResponse = await first;
      assert.equal(firstResponse.status, 200);
    } finally {
      releaseGate();
      await first.catch(() => {});
      StudentProfile.findOneAndUpdate = original;
    }
    const profile = await StudentProfile.findOne({ userId: userA._id }).lean();
    const added = profile.education.filter((item) => item.institution === "Example University");
    assert.equal(added.length, 1);
    assert.equal(profile.education[0].institution, "Kept University");
    const gone = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(gone.status, 404);
  });

  test("rejects a non-student before changing a profile", async () => {
    const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));
    const professional = await User.create({
      name: "Professional Apply",
      email: `apply_pro_${Date.now()}@example.com`,
      password: "hash",
      identity: "professional",
    });
    const token = jwt.sign(
      { id: professional._id.toString(), email: professional.email },
      jwtSecret,
    );
    const review = await reviewFrom();
    const before = await StudentProfile.findOne({ userId: userA._id }).lean();
    const response = await applyStudentResume(applyRequest(token, {
      reviewId: review.reviewId,
      selections: [{ section: "education", index: 0, fields: ["institution", "degree"] }],
    }));
    assert.equal(response.status, 403);
    const after = await StudentProfile.findOne({ userId: userA._id }).lean();
    assert.equal(after.education.length, before.education.length);
    assert.equal(await StudentProfile.countDocuments({ userId: professional._id }), 0);
    const stillThere = await readStudentResumeReview(
      new Request("http://127.0.0.1/review", { headers: { authorization: `Bearer ${tokenA}` } }),
      review.reviewId,
    );
    assert.equal(stillThere.status, 200);
  });
});
