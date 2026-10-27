/**
 * OneVue — Public Profile DTO, Website Models & Privacy Regression Test Suite
 *
 * Verifies Phase 2 requirements:
 * 1. Valid populated profile mapping
 * 2. Missing optional fields handled safely
 * 3. Source profile immutability (no mutation)
 * 4. dob and gender exclusion
 * 5. rollNumber exclusion
 * 6. Internal IDs and storage keys exclusion
 * 7. Email visibility enforcement (omitted unless visibility.email === 'public')
 * 8. Phone visibility enforcement (omitted unless visibility.phone === 'public')
 * 9. Private media exclusion (visibility === 'private')
 * 10. Resume links and storageKey stripping
 * 11. Credentials and achievements publication policy
 * 12. Unexpected extra source properties leakage prevention
 * 13. Dangerous URL schemes (javascript:, data:) rejection
 * 14. Malformed and unexpected input safety
 * 15. Output DTO version and checksum integrity
 * 16. UserWebsiteConfig and PublishedProfileRevision model schema constraints
 */

const { test, describe } = require("node:test");
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

const {
  toPublicProfileDTO,
  allowlistPublicSnapshot,
  sanitizeUrl,
  resolvePublicProfilePhoto,
  computeSnapshotChecksum,
  PUBLIC_PROFILE_SCHEMA_VERSION,
} = require(path.join(projectRoot, "lib", "public-profile-dto.ts"));

const UserWebsiteConfig = require(path.join(
  projectRoot,
  "models",
  "UserWebsiteConfig.ts"
)).default;

const PublishedProfileRevision = require(path.join(
  projectRoot,
  "models",
  "PublishedProfileRevision.ts"
)).default;

describe("OneVue Phase 2 — Public Profile DTO & Privacy Contract", () => {
  // Test fixture representing a fully populated student profile with private & public fields
  const getFullSourceProfile = () => ({
    _id: "660c00000000000000000001",
    userId: "660c00000000000000000002",
    __v: 3,
    preferredName: "Alex Rivera",
    profilePhoto: "https://example.com/photos/alex.jpg",
    headline: "CS Student & Full-Stack Developer",
    bio: "Passionate about building scalable distributed systems and accessible UIs.",
    dob: "2003-05-14", // SENSITIVE: MUST NEVER LEAK
    gender: "non-binary", // SENSITIVE: MUST NEVER LEAK
    nationality: "Canadian",
    city: "Toronto",
    state: "Ontario",
    country: "Canada",
    currentStatus: "Enrolled",
    careerInterests: ["Distributed Systems", "Cloud Infrastructure"],
    areasOfInterest: ["Compilers", "Databases"],
    languages: [
      { language: "English", proficiency: "native" },
      { language: "French", proficiency: "conversational" },
    ],
    education: [
      {
        id: "edu_1",
        institution: "University of Waterloo",
        degree: "Bachelor of Computer Science",
        fieldOfStudy: "Software Engineering",
        startDate: "2021",
        endDate: "2025",
        currentStatus: "studying",
        gpa: "3.9",
        rollNumber: "UW-2021-99884", // SENSITIVE: MUST NEVER LEAK
        location: "Waterloo, ON",
        website: "https://uwaterloo.ca",
        honors: "Dean's Honours List",
      },
    ],
    projects: [
      {
        id: "proj_1",
        title: "Nebula KV",
        shortDescription: "A distributed key-value store in Go",
        detailedDescription: "Implements Raft consensus with persistent write-ahead logging.",
        projectType: "open_source",
        technologies: ["Go", "Raft", "gRPC"],
        repoUrl: "https://github.com/alex/nebula-kv",
        liveUrl: "https://nebula.dev",
        videoUrl: "https://youtube.com/watch?v=demo",
        aiDetails: {
          // INTERNAL / SENSITIVE: MUST NEVER LEAK
          modelName: "internal-eval-v1",
          metrics: "loss=0.01",
        },
      },
    ],
    skills: [
      {
        id: "skill_1",
        name: "TypeScript",
        category: "Programming Languages",
        proficiency: "Advanced",
        level: "L4",
      },
    ],
    credentials: [
      {
        id: "cred_1",
        title: "AWS Certified Developer",
        credentialType: "certification",
        issuer: "Amazon Web Services",
        issueDate: "2023-11-01",
        credentialUrl: "https://aws.amazon.com/verify/123",
        verificationStatus: "verified",
      },
    ],
    achievements: [
      {
        id: "ach_1",
        title: "1st Place HackTheNorth",
        category: "hackathon",
        organization: "HackTheNorth",
        date: "2023-09-17",
        awardPrize: "$5000 Grand Prize",
        evidenceStorageKey: "secure/evidence/ach_1.pdf", // SENSITIVE: MUST NEVER LEAK
        proofUrl: "https://devpost.com/software/hack-entry",
      },
    ],
    resume: {
      storageKey: "resumes/student_private_key_xyz.pdf", // SENSITIVE: MUST NEVER LEAK
      fileName: "Alex_Rivera_Resume.pdf",
      uploadedAt: new Date("2024-01-15T10:00:00Z"),
      targetRole: "Software Engineer",
    },
    resumeUrl: "https://cdn.onevue.id/public/alex_resume.pdf",
    media: [
      {
        id: "media_pub",
        mediaUrl: "https://example.com/media/demo.png",
        mediaType: "image",
        title: "Nebula Architecture Diagram",
        category: "project",
        visibility: "public",
      },
      {
        id: "media_priv",
        mediaUrl: "https://example.com/media/draft_confidential.png",
        mediaType: "image",
        title: "Private Wireframe",
        category: "project",
        visibility: "private", // SENSITIVE: MUST NEVER LEAK
      },
    ],
    contacts: {
      email: "alex.contact@example.com",
      phone: "+1-416-555-0199",
      countryCode: "+1",
      city: "Toronto",
      state: "Ontario",
      country: "Canada",
      visibility: {
        email: "private", // SENSITIVE: MUST BE SUPPRESSED
        phone: "private", // SENSITIVE: MUST BE SUPPRESSED
      },
      github: "https://github.com/alexrivera",
      linkedin: "https://linkedin.com/in/alexrivera",
      twitter: "https://twitter.com/alexrivera",
      portfolio: "https://alexrivera.dev",
    },
    links: [
      {
        id: "link_pub",
        platform: "GitHub",
        url: "https://github.com/alexrivera",
        category: "coding",
        visibility: "public",
      },
      {
        id: "link_priv",
        platform: "Internal Portal",
        url: "https://internal.company.com/alex",
        category: "other",
        visibility: "private", // SENSITIVE: MUST NEVER LEAK
      },
    ],
    // Unexpected extraneous properties that must never leak through allowlist
    secretInternalNote: "Needs review by dean",
    adminFlag: true,
    shadowBanned: false,
  });

  test("1. A valid populated profile maps to the expected DTO structure", () => {
    const source = getFullSourceProfile();
    const options = {
      username: "alexrivera",
      canonicalUrl: "https://onevue.id/p/alexrivera",
      publishedAt: new Date("2026-10-14T08:00:00Z"),
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      user: { name: "Alex Rivera" },
    };

    const dto = toPublicProfileDTO(source, options);

    assert.equal(dto.meta.schemaVersion, PUBLIC_PROFILE_SCHEMA_VERSION);
    assert.equal(dto.meta.username, "alexrivera");
    assert.equal(dto.meta.canonicalUrl, "https://onevue.id/p/alexrivera");
    assert.equal(dto.meta.templateId, "magicui-portfolio");
    assert.equal(dto.meta.templateVersion, "1.0.0");
    assert.equal(dto.profile.displayName, "Alex Rivera");
    assert.equal(dto.profile.initials, "AR");
    assert.equal(dto.profile.headline, "CS Student & Full-Stack Developer");
    assert.equal(dto.education.length, 1);
    assert.equal(dto.education[0].institution, "University of Waterloo");
    assert.equal(dto.projects.length, 1);
    assert.equal(dto.projects[0].title, "Nebula KV");
    assert.equal(dto.skills.length, 1);
    assert.equal(dto.credentials.length, 1);
    assert.equal(dto.achievements.length, 1);
  });

  test("2. Missing optional fields are handled safely without crashing", () => {
    const minimalSource = {
      preferredName: "Minimal Sam",
    };

    const dto = toPublicProfileDTO(minimalSource);

    assert.equal(dto.meta.schemaVersion, "1.0.0");
    assert.equal(dto.profile.displayName, "Minimal Sam");
    assert.equal(dto.profile.initials, "MS");
    assert.deepEqual(dto.education, []);
    assert.deepEqual(dto.projects, []);
    assert.deepEqual(dto.skills, []);
    assert.deepEqual(dto.credentials, []);
    assert.deepEqual(dto.achievements, []);
    assert.deepEqual(dto.media, []);
    assert.equal(dto.resume, undefined);
    assert.equal(dto.contact.email, undefined);
    assert.equal(dto.contact.phone, undefined);
    assert.deepEqual(dto.contact.socialLinks, []);
  });

  test("3. Source profile is not mutated during transformation", () => {
    const source = getFullSourceProfile();
    const serializedBefore = JSON.stringify(source);

    // Call mapper
    const dto = toPublicProfileDTO(source, { username: "alex" });

    // Assert source object is strictly identical to before
    const serializedAfter = JSON.stringify(source);
    assert.equal(serializedBefore, serializedAfter);
  });

  test("4. Date of birth (dob) and gender NEVER appear in the public DTO", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);
    const dtoDump = JSON.stringify(dto);

    assert.equal("dob" in dto.profile, false);
    assert.equal("gender" in dto.profile, false);
    assert.equal(dtoDump.includes("2003-05-14"), false);
    assert.equal(dtoDump.includes("non-binary"), false);
  });

  test("5. Student roll number and private institutional identifiers never appear", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);
    const dtoDump = JSON.stringify(dto);

    assert.equal("rollNumber" in dto.education[0], false);
    assert.equal(dtoDump.includes("UW-2021-99884"), false);
  });

  test("6. Internal database IDs and storage keys are completely omitted", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);
    const dtoDump = JSON.stringify(dto);

    // Root identifiers
    assert.equal("_id" in dto, false);
    assert.equal("userId" in dto, false);
    assert.equal("__v" in dto, false);

    // Storage keys
    assert.equal(dtoDump.includes("student_private_key_xyz.pdf"), false);
    assert.equal(dtoDump.includes("secure/evidence/ach_1.pdf"), false);

    if (dto.resume) {
      assert.equal("storageKey" in dto.resume, false);
    }
    assert.equal("evidenceStorageKey" in dto.achievements[0], false);
    assert.equal("aiDetails" in dto.projects[0], false);
  });

  test("7. Email is omitted when visibility is private or non-public", () => {
    // Case 7a: Private email
    const sourcePrivate = getFullSourceProfile();
    sourcePrivate.contacts.visibility.email = "private";
    const dtoPrivate = toPublicProfileDTO(sourcePrivate);
    assert.equal(dtoPrivate.contact.email, undefined);

    // Case 7b: Recruiters only
    const sourceRecruiter = getFullSourceProfile();
    sourceRecruiter.contacts.visibility.email = "recruiters";
    const dtoRecruiter = toPublicProfileDTO(sourceRecruiter);
    assert.equal(dtoRecruiter.contact.email, undefined);

    // Case 7c: Explicitly public
    const sourcePublic = getFullSourceProfile();
    sourcePublic.contacts.visibility.email = "public";
    const dtoPublic = toPublicProfileDTO(sourcePublic);
    assert.equal(dtoPublic.contact.email, "alex.contact@example.com");
  });

  test("8. Phone number is omitted when visibility is private or non-public", () => {
    // Case 8a: Private phone
    const sourcePrivate = getFullSourceProfile();
    sourcePrivate.contacts.visibility.phone = "private";
    const dtoPrivate = toPublicProfileDTO(sourcePrivate);
    assert.equal(dtoPrivate.contact.phone, undefined);
    assert.equal(dtoPrivate.contact.countryCode, undefined);

    // Case 8b: Explicitly public phone
    const sourcePublic = getFullSourceProfile();
    sourcePublic.contacts.visibility.phone = "public";
    const dtoPublic = toPublicProfileDTO(sourcePublic);
    assert.equal(dtoPublic.contact.phone, "+1-416-555-0199");
    assert.equal(dtoPublic.contact.countryCode, "+1");
  });

  test("9. Private media items are strictly excluded from output", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);

    assert.equal(dto.media.length, 1);
    assert.equal(dto.media[0].id, "media_pub");
    assert.equal(dto.media[0].title, "Nebula Architecture Diagram");

    const dtoDump = JSON.stringify(dto);
    assert.equal(dtoDump.includes("draft_confidential.png"), false);
    assert.equal(dtoDump.includes("Private Wireframe"), false);
  });

  test("10. Resume links follow verified visibility and strip storageKey", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);

    assert.ok(dto.resume);
    assert.equal(dto.resume.url, "https://cdn.onevue.id/public/alex_resume.pdf");
    assert.equal(dto.resume.fileName, "Alex_Rivera_Resume.pdf");
    assert.equal("storageKey" in dto.resume, false);

    // When resumeUrl is missing or invalid protocol
    source.resumeUrl = "javascript:steal()";
    const dtoInvalid = toPublicProfileDTO(source);
    assert.equal(dtoInvalid.resume, undefined);
  });

  test("11. Credentials and achievements follow approved publication policy", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);

    assert.equal(dto.credentials.length, 1);
    assert.equal(dto.credentials[0].title, "AWS Certified Developer");
    assert.equal(dto.credentials[0].credentialUrl, "https://aws.amazon.com/verify/123");

    assert.equal(dto.achievements.length, 1);
    assert.equal(dto.achievements[0].title, "1st Place HackTheNorth");
    assert.equal(dto.achievements[0].awardPrize, "$5000 Grand Prize");
    assert.equal("evidenceStorageKey" in dto.achievements[0], false);
  });

  test("12. Unexpected extra source properties cannot leak through allowlist", () => {
    const source = getFullSourceProfile();
    const dto = toPublicProfileDTO(source);

    assert.equal("secretInternalNote" in dto, false);
    assert.equal("adminFlag" in dto, false);
    assert.equal("shadowBanned" in dto, false);

    const dtoDump = JSON.stringify(dto);
    assert.equal(dtoDump.includes("Needs review by dean"), false);
  });

  test("13. Invalid or unsafe URL schemes (javascript:, data:) are rejected/omitted", () => {
    const source = getFullSourceProfile();
    source.projects[0].liveUrl = "javascript:alert('xss')";
    source.projects[0].repoUrl = "data:text/html,<script>alert(1)</script>";
    source.contacts.github = "vbscript:malicious()";
    source.education[0].website = "file:///etc/passwd";

    const dto = toPublicProfileDTO(source);

    assert.equal(dto.projects[0].liveUrl, undefined);
    assert.equal(dto.projects[0].repoUrl, undefined);
    assert.equal(dto.contact.github, undefined);
    assert.equal(dto.education[0].website, undefined);

    // Valid URLs must be preserved
    assert.equal(sanitizeUrl("https://valid.com/path"), "https://valid.com/path");
    assert.equal(sanitizeUrl("http://localhost:3000/api"), "http://localhost:3000/api");
    assert.equal(sanitizeUrl("javascript:evil()"), undefined);
    assert.equal(sanitizeUrl("   "), undefined);
    assert.equal(sanitizeUrl(null), undefined);
  });

  test("14. Malformed and unexpected input does not cause private data leakage", () => {
    assert.doesNotThrow(() => toPublicProfileDTO(null));
    assert.doesNotThrow(() => toPublicProfileDTO(undefined));
    assert.doesNotThrow(() => toPublicProfileDTO("string input"));
    assert.doesNotThrow(() => toPublicProfileDTO(12345));
    assert.doesNotThrow(() => toPublicProfileDTO([]));

    const dtoFromNull = toPublicProfileDTO(null);
    assert.equal(dtoFromNull.meta.schemaVersion, "1.0.0");
    assert.equal(dtoFromNull.profile.displayName, "Student");
    assert.deepEqual(dtoFromNull.projects, []);
  });

  test("15. Output conforms to declared DTO version and produces deterministic checksum", () => {
    const source = getFullSourceProfile();
    const dto1 = toPublicProfileDTO(source, { username: "alexrivera" });
    const dto2 = toPublicProfileDTO(source, { username: "alexrivera" });

    assert.equal(dto1.meta.schemaVersion, "1.0.0");

    const checksum1 = computeSnapshotChecksum(dto1);
    const checksum2 = computeSnapshotChecksum(dto2);

    assert.equal(typeof checksum1, "string");
    assert.equal(checksum1.length, 64);
    assert.match(checksum1, /^[a-f0-9]{64}$/);
    assert.equal(checksum1, checksum2, "Checksums for identical DTOs must be deterministic");
  });

  test("18. An uploaded account photo becomes the public avatar", () => {
    const source = getFullSourceProfile();
    const key = "user_abc123_1710000000000_0123456789abcdef.jpg";
    const dto = toPublicProfileDTO(source, { user: { profilePhotoKey: key } });

    assert.equal(dto.profile.profilePhoto, `/api/profile/photo/${key}`);
    assert.equal(
      resolvePublicProfilePhoto(dto.profile.profilePhoto, key, "http://localhost:3000"),
      `http://localhost:3000/api/profile/photo/${key}`
    );
    assert.equal(resolvePublicProfilePhoto("javascript:alert(1)", "../secrets.png", "http://localhost:3000"), undefined);
    assert.equal(
      resolvePublicProfilePhoto("https://example.com/photos/alex.jpg", null, "http://localhost:3000"),
      "https://example.com/photos/alex.jpg"
    );
  });
});

describe("OneVue Phase 2 — Model Schema & Validation Constraints", () => {
  test("16. UserWebsiteConfig model validates username, templates, and theme settings", async () => {
    // Valid config
    const validConfig = new UserWebsiteConfig({
      userId: "660c00000000000000000010",
      username: "alexrivera",
      selectedTemplateId: "magicui-portfolio",
      selectedTemplateVersion: "1.0.0",
      customization: {
        accentColor: "#3b82f6",
        themeMode: "system",
      },
      status: "draft",
    });

    const validErr = await validConfig.validate().catch((err) => err);
    assert.equal(validErr, undefined);

    // Invalid username (too short, uppercase, symbols at ends)
    const invalidUsernameConfig = new UserWebsiteConfig({
      userId: "660c00000000000000000010",
      username: "Al-", // invalid: ends with hyphen, capital letter
      selectedTemplateId: "magicui-portfolio",
    });
    const usernameErr = await invalidUsernameConfig.validate().catch((err) => err);
    assert.ok(usernameErr && usernameErr.errors.username);

    // Invalid unapproved template
    const invalidTemplateConfig = new UserWebsiteConfig({
      userId: "660c00000000000000000010",
      username: "alexrivera",
      selectedTemplateId: "unapproved-random-template",
    });
    const templateErr = await invalidTemplateConfig.validate().catch((err) => err);
    assert.ok(templateErr && templateErr.errors.selectedTemplateId);

    // Invalid accent color hex
    const invalidColorConfig = new UserWebsiteConfig({
      userId: "660c00000000000000000010",
      username: "alexrivera",
      selectedTemplateId: "magicui-portfolio",
      customization: {
        accentColor: "blue; drop table users;",
      },
    });
    const colorErr = await invalidColorConfig.validate().catch((err) => err);
    assert.ok(colorErr && colorErr.errors["customization.accentColor"]);
  });

  test("17. PublishedProfileRevision model validates DTO snapshot and checksum", async () => {
    const validSnapshot = toPublicProfileDTO({ preferredName: "Alex" }, { username: "alex" });
    const checksum = computeSnapshotChecksum(validSnapshot);

    const validRevision = new PublishedProfileRevision({
      userId: "660c00000000000000000010",
      websiteConfigId: "660c00000000000000000020",
      revisionNumber: 1,
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      snapshot: validSnapshot,
      checksum,
    });

    const validErr = await validRevision.validate().catch((err) => err);
    assert.equal(validErr, undefined);

    // Missing snapshot validation failure
    const invalidRevision = new PublishedProfileRevision({
      userId: "660c00000000000000000010",
      websiteConfigId: "660c00000000000000000020",
      revisionNumber: 1,
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      snapshot: { invalidField: true }, // Fails PublicProfileDTO validator
      checksum: "short_bad_checksum",
    });

    const invalidErr = await invalidRevision.validate().catch((err) => err);
    assert.ok(invalidErr);
    assert.ok(invalidErr.errors.snapshot);
    assert.ok(invalidErr.errors.checksum);
  });

  test("18. Safe project images and identity sections are allowlisted", () => {
    const assetId = "ast_" + "a".repeat(24);
    const dto = toPublicProfileDTO({
      preferredName: "Ada",
      projects: [
        {
          id: "lamp",
          title: "Lamp",
          imageUrl: "https://cdn.example/lamp.jpg",
          assetId: "ast_should_not_leak",
          storageKey: "private/object",
        },
        {
          id: "bad",
          title: "Bad image",
          imageUrl: "javascript:alert(1)",
        },
        {
          id: "linked",
          title: "Linked shot",
        },
      ],
      media: [
        {
          id: "shot",
          title: "Shot",
          mediaUrl: "https://cdn.example/shot.png",
          relatedProject: "linked",
          visibility: "public",
          mediaType: "image",
        },
        {
          id: "hidden",
          title: "Hidden",
          mediaUrl: "https://cdn.example/hidden.png",
          relatedProject: "lamp",
          visibility: "private",
          mediaType: "image",
        },
      ],
      experience: [{ title: "Engineer", organization: "Acme", secretNote: "hidden role note" }],
      testimonials: [{ quote: "Excellent", authorName: "Jamie", relationship: "Client", privateEmail: "jamie@secret.test" }],
      team: [{ name: "Shown", role: "CEO", privatePhone: "555-0100" }],
      internalNote: "do not leak",
    });

    assert.equal(dto.projects[0].imageUrl, "https://cdn.example/lamp.jpg");
    assert.equal("assetId" in dto.projects[0], false);
    assert.equal("imageUrl" in dto.projects[1], false);
    assert.equal(dto.projects[2].imageUrl, "https://cdn.example/shot.png");
    assert.equal(dto.experience[0].organization, "Acme");
    assert.equal("secretNote" in dto.experience[0], false);
    assert.equal(dto.testimonials[0].authorName, "Jamie");
    assert.equal(dto.team[0].name, "Shown");
    const dump = JSON.stringify(dto);
    assert.equal(dump.includes("do not leak"), false);
    assert.equal(dump.includes("private/object"), false);
    assert.equal(dump.includes("ast_should_not_leak"), false);
    assert.equal(dump.includes("555-0100"), false);
    assert.equal(dump.includes("jamie@secret.test"), false);
    assert.equal(dump.includes("hidden.png"), false);
    assert.equal(dump.includes(assetId), false);
  });

  test("19. An existing 1.0.0 snapshot stays readable and unknown keys are removed", () => {
    const imagePath = "/api/assets/public/ast_" + "a".repeat(24);
    const listed = allowlistPublicSnapshot({
      meta: { schemaVersion: "1.0.0", username: "ada" },
      profile: {
        displayName: "Ada Lovelace",
        initials: "AL",
        location: { city: "London" },
        careerInterests: [],
        areasOfInterest: [],
        languages: [],
        secret: "nope",
      },
      education: [],
      projects: [{ id: "p1", title: "Engine", technologies: [], imageUrl: imagePath, storageKey: "secret/key" }],
      skills: [],
      credentials: [{ id: "c1", title: "Math", credentialType: "certification", issuer: "Society" }],
      achievements: [{ id: "a1", title: "Engineer at Initech", category: "experience", organization: "Initech", role: "Engineer" }],
      media: [],
      contact: { socialLinks: [] },
      secretInternalNote: "Needs review by dean",
    });

    assert.ok(listed);
    assert.equal(listed.meta.schemaVersion, "1.0.0");
    assert.equal(listed.profile.displayName, "Ada Lovelace");
    assert.equal("secret" in listed.profile, false);
    assert.equal(listed.projects[0].imageUrl, imagePath);
    assert.equal("storageKey" in listed.projects[0], false);
    assert.equal(listed.credentials[0].title, "Math");
    assert.equal(listed.achievements[0].category, "experience");
    assert.equal(listed.experience, undefined);
    assert.equal("secretInternalNote" in listed, false);
    assert.equal(JSON.stringify(listed).includes("Needs review by dean"), false);
    assert.equal(JSON.stringify(listed).includes("secret/key"), false);
    assert.equal(allowlistPublicSnapshot({ meta: { schemaVersion: "9.9.9" }, profile: { displayName: "X" } }), null);
  });
});
