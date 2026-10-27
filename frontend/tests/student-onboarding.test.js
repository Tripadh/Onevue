const { test } = require("node:test");
const assert = require("node:assert/strict");
const onboarding = require("../services/student-onboarding.js");

test("a new student starts on the choice screen", function () {
  assert.equal(onboarding.resolveStep({ profile: { headline: "", bio: "", education: [] }, done: false, savedStep: "" }), "choice");
});

test("a saved profile opens the existing editor", function () {
  assert.equal(onboarding.resolveStep({
    profile: { headline: "Student engineer", bio: "", education: [] },
    done: false,
    savedStep: "",
  }), null);
});

test("a finished onboarding flag opens the existing editor", function () {
  assert.equal(onboarding.resolveStep({ profile: null, done: true, savedStep: "choice" }), null);
});

test("navigation keeps an in-progress step and moves back without dropping it", function () {
  assert.equal(onboarding.resolveStep({ profile: null, done: false, savedStep: "profile" }), "profile");
  assert.equal(onboarding.goBack("profile"), "choice");
  assert.equal(onboarding.goForward("profile"), "resume");
  assert.equal(onboarding.goBack("resume"), "profile");
  assert.equal(onboarding.goBack("extract"), "choice");
});

test("manual entry starts from an empty draft", function () {
  const draft = onboarding.emptyDraft();
  assert.equal(draft.headline, "");
  assert.equal(draft.bio, "");
  assert.equal(draft.education.length, 0);
  assert.equal(draft.projects.length, 0);
});

test("resume extraction fills the draft and does not erase a field the resume omitted", function () {
  const draft = onboarding.applyExtraction({
    headline: "Typed by hand",
    bio: "",
    contacts: { email: "kept@example.com", phone: "" },
    education: [],
    projects: [{ title: "Manual Project", shortDescription: "Keep me" }],
    skills: [],
    credentials: [],
    achievements: [],
    links: [],
  }, [
    { section: "profile", entryIndex: 0, field: "summary", value: "Builds tools." },
    { section: "education", entryIndex: 0, field: "institution", value: "Example University" },
    { section: "education", entryIndex: 0, field: "degree", value: "BSc" },
    { section: "education", entryIndex: 0, field: "fieldOfStudy", value: "Mathematics" },
    { section: "skills", entryIndex: 0, field: "name", value: "Analysis" },
    { section: "socialLinks", entryIndex: 0, field: "platform", value: "github" },
    { section: "socialLinks", entryIndex: 0, field: "url", value: "https://github.com/ada" },
  ]);
  assert.equal(draft.headline, "Typed by hand");
  assert.equal(draft.bio, "Builds tools.");
  assert.equal(draft.contacts.email, "kept@example.com");
  assert.equal(draft.projects[0].title, "Manual Project");
  assert.equal(draft.education[0].institution, "Example University");
  assert.equal(draft.education[0].degree, "BSc");
  assert.equal(draft.skills[0].name, "Analysis");
  assert.equal(draft.skills[0].category, "Other Skills");
  assert.equal(draft.links[0].url, "https://github.com/ada");
});

test("cancelling a replacement is represented by leaving the saved draft untouched", function () {
  const saved = onboarding.emptyDraft();
  saved.bio = "Kept biography";
  saved.links = [{ platform: "Portfolio", url: "https://example.com" }];
  const cancelled = onboarding.applyExtraction(saved, []);
  assert.equal(cancelled.bio, "Kept biography");
  assert.equal(cancelled.links[0].url, "https://example.com");
});

test("a selected replacement URL is the only link change", function () {
  const saved = onboarding.applyExtraction(onboarding.emptyDraft(), [
    { section: "socialLinks", entryIndex: 0, field: "platform", value: "Portfolio" },
    { section: "socialLinks", entryIndex: 0, field: "url", value: "https://www.srisivaprasadinstitution.com/" },
  ]);
  assert.equal(saved.links.length, 1);
  assert.equal(saved.bio, "");
  const replaced = onboarding.applyExtraction(saved, [
    { section: "socialLinks", entryIndex: 0, field: "platform", value: "Portfolio" },
    { section: "socialLinks", entryIndex: 0, field: "url", value: "https://example.com/new" },
    { section: "profile", entryIndex: 0, field: "summary", value: "New summary" },
  ]);
  assert.equal(replaced.links.length, 1);
  assert.equal(replaced.links[0].url, "https://example.com/new");
  assert.equal(replaced.bio, "New summary");
});
