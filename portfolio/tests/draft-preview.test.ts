import test from "node:test";
import assert from "node:assert/strict";
import { adaptDraftPreview, isAllowedPreviewParent } from "../src/lib/draft-preview.ts";
import { SUPPORTED_DTO_SCHEMA_VERSION } from "../src/lib/onevue-profile-adapter.ts";
import type { PublicProfileDTO_v1 } from "../src/lib/onevue-profile-adapter.ts";

function draftDto(): PublicProfileDTO_v1 {
  return {
    meta: { schemaVersion: SUPPORTED_DTO_SCHEMA_VERSION, username: "ada" },
    profile: {
      displayName: "Ada Lovelace",
      initials: "AL",
      headline: "Mathematician",
      location: {},
      careerInterests: [],
      areasOfInterest: [],
      languages: [],
    },
    education: [],
    projects: [],
    skills: [],
    credentials: [],
    achievements: [],
    media: [],
    contact: { socialLinks: [] },
  };
}

test("draft preview adapts a saved 1.0.0 payload and does not require the new fields", () => {
  const result = adaptDraftPreview(
    { type: "onevue-draft-preview", dto: draftDto() },
    "http://localhost:5173"
  );
  assert.ok("data" in result);
  if (!("data" in result)) return;
  assert.equal(result.data.name, "Ada Lovelace");
  assert.equal(result.data.description, "Mathematician");
  assert.equal(result.data.work.length, 0);
  assert.equal(result.data.projects.length, 0);
});

test("draft preview rejects another schema version and an unapproved origin", () => {
  const dto = draftDto();
  dto.meta.schemaVersion = "2.0.0" as PublicProfileDTO_v1["meta"]["schemaVersion"];
  const rejected = adaptDraftPreview({ type: "onevue-draft-preview", dto }, "http://127.0.0.1:8080");
  assert.ok("error" in rejected);
  if (!("error" in rejected)) return;
  assert.match(rejected.error, /Unsupported profile schema version/);

  const foreign = adaptDraftPreview({ type: "onevue-draft-preview", dto: draftDto() }, "https://evil.example");
  assert.deepEqual(foreign, { error: "Preview parent origin is not allowed." });
  assert.equal(isAllowedPreviewParent("javascript:alert(1)"), false);
});
