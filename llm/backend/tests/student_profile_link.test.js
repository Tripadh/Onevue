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
});
