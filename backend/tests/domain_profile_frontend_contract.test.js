/**
 * Frontend identity-profile behavior that can run without a browser or MongoDB.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const frontendRoot = path.resolve(__dirname, "..", "..", "frontend");
const state = require(path.join(frontendRoot, "services", "identity-profile-state.js"));

describe("Identity profile frontend contract", () => {
  test("save failures do not produce a success notice and drafts initialize from the server", () => {
    let editor = state.createProfileEditorState();
    editor = state.profileEditorReducer(editor, { type: "load_start" });
    assert.equal(editor.loading, true);
    editor = state.profileEditorReducer(editor, {
      type: "load_success",
      profile: { headline: "From the server", skills: [{ id: "skill_1", name: "Go" }] },
    });
    assert.equal(editor.loading, false);
    assert.equal(editor.draft.headline, "From the server");
    assert.notEqual(editor.draft, editor.profile);

    editor = state.profileEditorReducer(editor, { type: "save_start" });
    editor = state.profileEditorReducer(editor, { type: "save_error", message: "Database unavailable" });
    assert.equal(editor.notice, "");
    assert.equal(editor.saveError, "Database unavailable");
    assert.equal(editor.saving, false);
    assert.equal(editor.draft.headline, "From the server");

    editor = state.profileEditorReducer(editor, {
      type: "save_success",
      profile: { headline: "Confirmed", skills: [] },
    });
    assert.equal(editor.notice, "saved");
    assert.equal(editor.draft.headline, "Confirmed");
  });

  test("records are added and removed by stable id", () => {
    const first = { id: state.newRecordId(), name: "First" };
    const second = { id: state.newRecordId(), name: "Second" };
    assert.notEqual(first.id, second.id);
    let list = state.upsertById([], first);
    list = state.upsertById(list, second);
    list = [list[1], list[0]];
    list = state.upsertById(list, { id: first.id, name: "First renamed" });
    assert.equal(list.find((item) => item.id === first.id).name, "First renamed");
    assert.equal(list.find((item) => item.id === second.id).name, "Second");
    list = state.removeById(list, second.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, first.id);
  });

  test("update payloads drop owner ids and client-controlled verification", () => {
    const payload = state.buildUpdatePayload("creator", {
      userId: "attacker",
      ownerId: "attacker",
      _id: "profile",
      niche: "Audio",
      audienceStats: [{
        id: "aud_1",
        _id: "ignore",
        platform: "YouTube",
        metric: "followers",
        value: 10,
        source: "self_reported",
        measuredAt: "2024-01-01",
        verificationStatus: "verified",
      }],
    });
    assert.equal(payload.userId, undefined);
    assert.equal(payload.ownerId, undefined);
    assert.equal(payload.audienceStats[0].verificationStatus, undefined);
    assert.equal(payload.audienceStats[0]._id, undefined);
    assert.equal(payload.audienceStats[0].id, "aud_1");
    assert.equal(payload.niche, "Audio");

    const business = state.buildUpdatePayload("business", {
      registration: { legalName: "Northwind", status: "verified", registrationNumber: "SECRET" },
    });
    assert.equal(business.registration.status, undefined);
    assert.equal(business.registration.registrationNumber, "SECRET");

    const pending = state.buildUpdatePayload("business", {
      registration: { status: "pending" },
    });
    assert.equal(pending.registration.status, "pending");
  });

  test("dashboards no longer toast success after a swallowed save", () => {
    for (const [dir, name] of [
      ["professional", "Professional"],
      ["freelancer", "Freelancer"],
      ["creator", "Creator"],
      ["business", "Business"],
    ]) {
      const read = (suffix) => fs.readFileSync(path.join(frontendRoot, `components/dashboard/${dir}/${name}${suffix}.jsx`), "utf8");
      const dashboard = read("Dashboard");
      const identityPage = read("IdentityPage");
      const overview = read("OverviewPage");
      for (const source of [dashboard, identityPage, overview]) {
        assert.equal(source.includes(".catch(() => {})"), false);
        assert.equal(source.includes("Live on OneVue"), false);
      }
      assert.match(identityPage, new RegExp(`IdentityProfileEditor identity="${dir}"`));
      assert.match(dashboard, /window\.StudentProfilePage session=\{session\}/);
    }

    const editor = fs.readFileSync(path.join(frontendRoot, "components/dashboard/shared/IdentityProfileEditor.jsx"), "utf8");
    assert.match(editor, /Profile was not saved/);
    const accountPage = fs.readFileSync(path.join(frontendRoot, "components/dashboard/student/StudentProfilePage.jsx"), "utf8");
    assert.match(accountPage, /auth\.updateProfile/);
    assert.match(accountPage, /tone: 'error'/);

    const student = fs.readFileSync(path.join(frontendRoot, "components/dashboard/student/StudentDashboard.jsx"), "utf8");
    assert.match(student, /\/student\/profile/);
    assert.match(student, /if \(!res\.ok\)/);

    const service = fs.readFileSync(path.join(frontendRoot, "services/domain-profile.js"), "utf8");
    assert.equal(service.includes("localStorage"), false);
    assert.match(service, /getIdentityProfile/);
    assert.match(service, /updateIdentityProfile/);
    assert.equal(service.includes("c:profiles"), false);
  });
});
