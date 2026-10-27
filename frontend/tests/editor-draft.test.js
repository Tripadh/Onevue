const { test } = require("node:test");
const assert = require("node:assert/strict");
const drafts = require("../services/editor-draft.js");

function memoryStorage() {
  const items = new Map();
  return {
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { items.set(key, String(value)); },
    removeItem(key) { items.delete(key); },
  };
}

test("a draft is restored only for the same account and server stamp", () => {
  const storage = memoryStorage();
  const ada = { user: { id: "ada" } };
  const grace = { user: { id: "grace" } };
  drafts.writeDraft(storage, "identity-professional", ada, { headline: "Local" }, "2026-10-01T00:00:00.000Z");
  const own = drafts.decideDraftRestore(
    drafts.readDraft(storage, "identity-professional", ada),
    { updatedAt: "2026-10-01T00:00:00.000Z", headline: "Server" }
  );
  assert.equal(own.action, "restore-local");
  assert.equal(own.draft.headline, "Local");
  assert.equal(drafts.readDraft(storage, "identity-professional", grace), null);
});

test("a newer server profile is not replaced by the browser draft", () => {
  const storage = memoryStorage();
  const ada = { user: { id: "ada" } };
  drafts.writeDraft(storage, "student-profile", ada, { headline: "Old local" }, "2026-10-01T00:00:00.000Z");
  const decision = drafts.decideDraftRestore(
    drafts.readDraft(storage, "student-profile", ada),
    { updatedAt: "2026-10-02T00:00:00.000Z", headline: "Newer server" }
  );
  assert.equal(decision.action, "use-server");
  assert.equal(decision.stale, true);
  assert.equal(decision.draft, undefined);
});

test("a missing account id does not use a shared draft bucket", () => {
  const storage = memoryStorage();
  assert.equal(drafts.storageKey("identity-creator", { user: {} }), "");
  assert.equal(drafts.writeDraft(storage, "identity-creator", { user: {} }, { headline: "Shared" }, "2026-10-01T00:00:00.000Z"), false);
  assert.equal(drafts.readDraft(storage, "identity-creator", { user: {} }), null);
  assert.equal(drafts.readDraft(storage, "identity-creator", null), null);
});

test("a failed save can be recovered while the server stamp is unchanged", () => {
  const storage = memoryStorage();
  const ada = { user: { email: "ada@example.com" } };
  drafts.writeDraft(storage, "identity-freelancer", ada, { headline: "Not saved" }, "2026-10-01T00:00:00.000Z");
  const decision = drafts.decideDraftRestore(
    drafts.readDraft(storage, "identity-freelancer", ada),
    { updatedAt: "2026-10-01T00:00:00.000Z" }
  );
  assert.equal(decision.action, "restore-local");
  assert.equal(decision.draft.headline, "Not saved");
});
