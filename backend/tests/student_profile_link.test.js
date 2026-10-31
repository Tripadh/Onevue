/**
 * Student profile linkage uses an ephemeral MongoDB.
 * It does not read local environment files or the development database.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const projectRoot = path.resolve(__dirname, "..");
const { MongoMemoryServer } = require(path.join(
  projectRoot,
  "certificate-verification",
  "node_modules",
  "mongodb-memory-server",
));
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolve.call(this, request, parent, isMain, options);
  } catch (error) {
    if (
      error &&
      error.code === "MODULE_NOT_FOUND" &&
      typeof request === "string" &&
      request.startsWith(".")
    ) {
      return originalResolve.call(this, request + ".ts", parent, isMain, options);
    }
    throw error;
  }
};

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
};

function jsonRequest(url, method, token, body) {
  return new Request(url, {
    method,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
      origin: "http://127.0.0.1:8080",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("student profile linkage", () => {
  let memory;
  let mongoose;
  let User;
  let StudentProfile;
  let ensureStudentProfile;
  let setIdentityRoute;
  let profileRoute;
  let jwt;
  const jwtSecret = "profile-link-test-secret";

  before(async () => {
    memory = await MongoMemoryServer.create();
    process.env.MONGODB_URI = memory.getUri();
    process.env.JWT_SECRET = jwtSecret;
    mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
    jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));
    await mongoose.connect(process.env.MONGODB_URI);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    ensureStudentProfile = require(path.join(projectRoot, "lib", "ensure-student-profile.ts")).ensureStudentProfile;
    setIdentityRoute = require(path.join(projectRoot, "app", "api", "auth", "set-identity", "route.ts"));
    profileRoute = require(path.join(projectRoot, "app", "api", "student", "profile", "route.ts"));
  });

  after(async () => {
    if (mongoose) await mongoose.disconnect();
    if (memory) await memory.stop();
  });

  test("assigning the student role creates one profile for that user", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Link Student ${stamp}`,
      email: `link_${stamp}@example.com`,
      password: "hash",
      identity: "professional",
    });
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);

    const response = await setIdentityRoute.POST(
      jsonRequest("http://localhost:3000/api/auth/set-identity", "POST", token, { identity: "student" }),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.identity, "student");
    assert.equal(String(body.user.id), user._id.toString());

    const profiles = await StudentProfile.find({ userId: user._id });
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].userId.toString(), user._id.toString());
    assert.equal(profiles[0].contacts.email, "");

    const again = await setIdentityRoute.POST(
      jsonRequest("http://localhost:3000/api/auth/set-identity", "POST", token, { identity: "student" }),
    );
    assert.equal(again.status, 200);
    assert.equal(await StudentProfile.countDocuments({ userId: user._id }), 1);
  });

  test("retrieval creates a missing profile and refuses another student's profile", async () => {
    const stamp = Date.now();
    const owner = await User.create({
      name: `Owner ${stamp}`,
      email: `owner_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const other = await User.create({
      name: `Other ${stamp}`,
      email: `other_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const ownerToken = jwt.sign({ id: owner._id.toString(), email: owner.email }, jwtSecret);
    const otherToken = jwt.sign({ id: other._id.toString(), email: other.email }, jwtSecret);

    const created = await profileRoute.GET(
      jsonRequest("http://localhost:3000/api/student/profile", "GET", ownerToken),
    );
    const createdBody = await created.json();
    assert.equal(created.status, 200);
    assert.equal(createdBody.profile.userId.toString(), owner._id.toString());
    assert.equal(created.headers.get("access-control-allow-origin"), "http://127.0.0.1:8080");

    await StudentProfile.updateOne({ userId: owner._id }, { $set: { headline: "Owner only" } });

    const foreign = await profileRoute.GET(
      jsonRequest("http://localhost:3000/api/student/profile", "GET", otherToken),
    );
    const foreignBody = await foreign.json();
    assert.equal(foreign.status, 200);
    assert.equal(foreignBody.profile.userId.toString(), other._id.toString());
    assert.notEqual(foreignBody.profile.headline, "Owner only");

    const hijack = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", otherToken, {
        userId: owner._id.toString(),
        headline: "Taken over",
      }),
    );
    assert.equal(hijack.status, 403);
    const ownerProfile = await StudentProfile.findOne({ userId: owner._id });
    assert.equal(ownerProfile.headline, "Owner only");
  });

  test("repairs a string user id without creating a second profile", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Legacy ${stamp}`,
      email: `legacy_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    await StudentProfile.collection.insertOne({
      userId: user._id.toString(),
      headline: "Already saved",
      contacts: { email: "" },
    });

    const profile = await ensureStudentProfile(user);
    assert.equal(profile.headline, "Already saved");
    assert.equal(profile.userId.toString(), user._id.toString());
    assert.equal(await StudentProfile.collection.countDocuments({
      $or: [{ userId: user._id }, { userId: user._id.toString() }],
    }), 1);

    const loaded = await profileRoute.GET(
      jsonRequest(
        "http://localhost:3000/api/student/profile",
        "GET",
        jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret),
      ),
    );
    const body = await loaded.json();
    assert.equal(loaded.status, 200);
    assert.equal(body.profile.headline, "Already saved");
    assert.equal(body.user.id.toString(), user._id.toString());
  });

  test("work experience and internships persist without removing stored media", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Experience Student ${stamp}`,
      email: `experience_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);
    await StudentProfile.create({
      userId: user._id,
      media: [{ title: "Existing poster", mediaUrl: "https://example.com/poster.png" }],
    });

    const saved = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        workExperience: [{
          id: "exp_intern",
          organization: "Example Labs",
          title: "Research Intern",
          experienceType: "internship",
          startDate: "2024-01",
          endDate: "2024-06",
          description: "Built research prototypes",
        }],
      }),
    );
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.profile.workExperience[0].organization, "Example Labs");
    assert.equal(savedBody.profile.workExperience[0].experienceType, "internship");
    assert.equal(savedBody.profile.media[0].title, "Existing poster");

    const invalid = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        workExperience: [{ organization: "Example Labs", title: "Intern", experienceType: "contractor" }],
      }),
    );
    assert.equal(invalid.status, 400);

    const stored = await StudentProfile.findOne({ userId: user._id }).lean();
    assert.equal(stored.workExperience[0].description, "Built research prototypes");
    assert.equal(stored.media[0].title, "Existing poster");
  });

  test("editing a credential saves its verification URL and leaves the rest of the profile intact", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Credential Editor ${stamp}`,
      email: `cred_edit_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);
    const originalUrl = "https://www.coursera.org/account/accomplishments/verify/10QG5GT9PJYN";
    const editedUrl = "https://www.coursera.org/account/accomplishments/verify/EDITED999";
    const otherUrl = "https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1";
    const java = {
      id: "crd-java",
      title: "Java Microservices with Spring Boot",
      issuer: "Edureka",
      credentialType: "course_certificate",
      credentialId: "10QG5GT9PJYN",
      verificationUrl: originalUrl,
      description: "Spring Boot course",
    };
    const other = {
      id: "crd-aws",
      title: "AWS Solutions Architect",
      issuer: "Amazon",
      credentialType: "certification",
      credentialId: "AWS-1",
      verificationUrl: otherUrl,
      description: "Cloud certificate",
    };

    const created = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        headline: "Keep this headline",
        credentials: [java, other],
      }),
    );
    assert.equal(created.status, 200);

    const edited = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        credentials: [{ ...java, verificationUrl: editedUrl }, other],
      }),
    );
    const editedBody = await edited.json();
    assert.equal(edited.status, 200);
    assert.equal(editedBody.profile.credentials[0].verificationUrl, editedUrl);
    assert.equal(editedBody.profile.credentials[0].issuer, "Edureka");
    assert.equal(editedBody.profile.credentials[0].title, java.title);
    assert.equal(editedBody.profile.credentials[0].credentialId, java.credentialId);
    assert.equal(editedBody.profile.credentials[0].description, java.description);
    assert.equal(editedBody.profile.credentials[1].id, other.id);
    assert.equal(editedBody.profile.credentials[1].verificationUrl, otherUrl);
    assert.equal(editedBody.profile.headline, "Keep this headline");

    const reloaded = await profileRoute.GET(
      jsonRequest("http://localhost:3000/api/student/profile", "GET", token),
    );
    const reloadedBody = await reloaded.json();
    assert.equal(reloaded.status, 200);
    assert.equal(reloadedBody.profile.credentials.length, 2);
    assert.equal(reloadedBody.profile.credentials[0].verificationUrl, editedUrl);
    assert.equal(reloadedBody.profile.credentials[0].issuer, "Edureka");
    assert.equal(reloadedBody.profile.credentials[1].title, other.title);
    assert.equal(reloadedBody.profile.headline, "Keep this headline");

    const stored = await StudentProfile.findOne({ userId: user._id });
    assert.equal(stored.credentials[0].verificationUrl, editedUrl);
    assert.equal(stored.credentials[0].issuer, "Edureka");
    assert.equal(stored.credentials[1].verificationUrl, otherUrl);

    const rejected = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        credentials: [{ ...java, verificationUrl: "not a url" }, other],
      }),
    );
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 400);
    assert.match(rejectedBody.message, /Invalid verificationUrl/);

    const afterFailure = await profileRoute.GET(
      jsonRequest("http://localhost:3000/api/student/profile", "GET", token),
    );
    const afterBody = await afterFailure.json();
    assert.equal(afterBody.profile.credentials[0].verificationUrl, editedUrl);
    assert.equal(afterBody.profile.credentials[1].verificationUrl, otherUrl);
    assert.equal(afterBody.profile.headline, "Keep this headline");
  });

  test("records keep their stored ids across reorders and id-only saves", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Stable Ids ${stamp}`,
      email: `stable_ids_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);

    const created = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        projects: [
          {
            id: "proj_alpha",
            title: "Alpha",
            customFields: [{ id: "fld_alpha_note", label: "Note", type: "text", value: "keep me" }],
          },
          { title: "Beta" },
        ],
      }),
    );
    const createdBody = await created.json();
    assert.equal(created.status, 200);

    const alpha = createdBody.profile.projects[0];
    const beta = createdBody.profile.projects[1];
    assert.equal(alpha.id, "proj_alpha");
    assert.ok(alpha._id);
    assert.ok(beta.id);
    assert.notEqual(beta.id, "proj_1");

    // A client may echo only `id`; the stored ObjectId must not be regenerated.
    const reordered = [beta, alpha].map(({ _id, __v, ...record }) => record);
    const saved = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        projects: reordered,
      }),
    );
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.profile.projects[0].id, beta.id);
    assert.equal(String(savedBody.profile.projects[0]._id), String(beta._id));
    assert.equal(savedBody.profile.projects[1].id, alpha.id);
    assert.equal(String(savedBody.profile.projects[1]._id), String(alpha._id));
    assert.equal(savedBody.profile.projects[1].customFields[0].value, "keep me");

    const stored = await StudentProfile.findOne({ userId: user._id }).lean();
    assert.equal(String(stored.projects[1]._id), String(alpha._id));
    assert.equal(stored.projects[1].id, "proj_alpha");
  });

  test("media and links keep server-managed fields when a save omits them", async () => {
    const stamp = Date.now();
    const user = await User.create({
      name: `Partial Records ${stamp}`,
      email: `partial_records_${stamp}@example.com`,
      password: "hash",
      identity: "student",
    });
    const token = jwt.sign({ id: user._id.toString(), email: user.email }, jwtSecret);
    const uploadedAt = new Date("2025-01-02T03:04:05.000Z");
    const assetId = "ast_0123456789abcdef01234567";

    await StudentProfile.create({
      userId: user._id,
      media: [{
        id: "media_poster",
        title: "Poster",
        mediaUrl: "https://example.com/poster.png",
        mediaType: "image",
        category: "project",
        visibility: "public",
        assetId,
        uploadedAt,
        customFields: [{ id: "fld_media_note", label: "Note", type: "text", value: "keep media" }],
      }],
      links: [{
        id: "link_github",
        platform: "GitHub",
        url: "https://github.com/example",
        category: "coding",
        visibility: "public",
        verificationStatus: "verified",
        customFields: [{ id: "fld_link_note", label: "Note", type: "text", value: "keep link" }],
      }],
    });

    const saved = await profileRoute.PUT(
      jsonRequest("http://localhost:3000/api/student/profile", "PUT", token, {
        media: [{
          id: "media_poster",
          title: "Poster renamed",
          mediaUrl: "https://example.com/poster.png",
          mediaType: "image",
          category: "project",
          visibility: "public",
        }],
        links: [{
          id: "link_github",
          platform: "GitHub",
          url: "https://github.com/example",
          category: "coding",
          visibility: "public",
        }],
      }),
    );
    const body = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(body.profile.media[0].title, "Poster renamed");
    assert.equal(body.profile.media[0].assetId, assetId);
    assert.equal(body.profile.media[0].customFields[0].value, "keep media");
    assert.equal(new Date(body.profile.media[0].uploadedAt).toISOString(), uploadedAt.toISOString());
    assert.equal(body.profile.links[0].verificationStatus, "verified");
    assert.equal(body.profile.links[0].customFields[0].value, "keep link");

    const stored = await StudentProfile.findOne({ userId: user._id }).lean();
    assert.equal(stored.media[0].customFields[0].value, "keep media");
    assert.equal(stored.links[0].customFields[0].value, "keep link");
  });
});
