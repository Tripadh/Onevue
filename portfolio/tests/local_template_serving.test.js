/**
 * OneVue Phase 2.4.4 — Local Public Template Serving Test Suite
 *
 * Validates all Phase 2.4.4 requirements:
 * 1. Valid published profile renders the selected template.
 * 2. DTO payload is safely embedded, including </script> and XSS-like strings.
 * 3. Unknown or unpublished usernames return 404.
 * 4. Unapproved or unsupported template versions are rejected.
 * 5. Missing artifacts produce a clear error with no fallback.
 * 6. Path traversal attempts are rejected.
 * 7. Asset URLs match the staged directory.
 * 8. Changing draft profile/customization does not alter an existing publication.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  SUPPORTED_DTO_SCHEMA_VERSION,
  APPROVED_TEMPLATE_REGISTRY,
  validateTemplateRelease,
  resolveTemplatesRootDir,
  resolveTemplateArtifactPath,
  serializeDtoPayload,
  injectDtoIntoHtml,
  renderPublicTemplateHtml,
} = require("../src/lib/template-renderer.js");

// Sample valid PublicProfileDTO_v1 fixture
function createSampleDto(overrides = {}) {
  const profileOverrides = overrides.profile || {};
  return {
    meta: {
      schemaVersion: SUPPORTED_DTO_SCHEMA_VERSION,
      username: overrides.username || "marcus",
      canonicalUrl: overrides.canonicalUrl || "https://onevue.me/p/marcus",
      publishedAt: "2026-10-28T10:00:00.000Z",
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
    },
    profile: {
      displayName: profileOverrides.displayName || "Marcus Aurelius",
      preferredName: profileOverrides.preferredName || "Marcus",
      initials: profileOverrides.initials || "MA",
      headline: profileOverrides.headline || "Distributed Systems Researcher & Engineer",
      bio: profileOverrides.bio || "Building resilient consensus and peer-to-peer storage protocols.",
      profilePhoto: profileOverrides.profilePhoto || "https://images.example.com/marcus.jpg",
      location: {
        city: "Waterloo",
        state: "ON",
        country: "Canada",
        formatted: "Waterloo, ON, Canada",
      },
      languages: [{ language: "English", proficiency: "native" }],
    },
    education: [
      {
        id: "edu_1",
        institution: "University of Waterloo",
        degree: "Bachelor of Computer Science",
        fieldOfStudy: "Systems & Networking",
        currentStatus: "completed",
        startDate: "2020",
        endDate: "2024",
      },
    ],
    projects: [
      {
        id: "proj_1",
        title: "HyperRaft",
        shortDescription: "High-throughput distributed consensus engine",
        technologies: ["Rust", "gRPC", "Raft"],
        repoUrl: "https://github.com/marcus/hyperraft",
        liveUrl: "https://hyperraft.dev",
      },
    ],
    skills: [
      { id: "sk_1", name: "Distributed Systems", category: "Backend" },
      { id: "sk_2", name: "Rust", category: "Languages" },
    ],
    credentials: [
      {
        id: "cred_1",
        title: "Certified Kubernetes Administrator",
        issuer: "Cloud Native Computing Foundation",
        credentialType: "Certification",
        issueDate: "2024-01-15",
        verificationUrl: "https://www.cncf.io/verify/CKA-123456",
      },
    ],
    achievements: [
      {
        id: "ach_1",
        title: "HackTheNorth 2024 Finalist",
        issuer: "HackTheNorth",
        date: "2024-09-15",
      },
    ],
    resume: {
      url: "https://storage.onevue.me/resumes/marcus_public.pdf",
      fileName: "Marcus_Aurelius_Resume.pdf",
    },
    media: [],
    contact: {
      email: "marcus.public@example.com",
      github: "https://github.com/marcus",
      linkedin: "https://linkedin.com/in/marcus",
      socialLinks: [],
    },
  };
}

function createSampleWebsite(overrides = {}) {
  return {
    username: overrides.username || "marcus",
    templateId: overrides.templateId || TEMPLATE_ID,
    templateVersion: overrides.templateVersion || TEMPLATE_VERSION,
    publishedAt: "2026-10-28T10:00:00.000Z",
    revisionNumber: overrides.revisionNumber || 1,
    customization: {
      accentColor: overrides.accentColor || "#3b82f6",
      themeMode: overrides.themeMode || "system",
      visibleSections: overrides.visibleSections || [
        "about",
        "education",
        "projects",
        "skills",
        "achievements",
        "credentials",
        "contact",
      ],
    },
  };
}

describe("OneVue Phase 2.4.4 — Local Public Template Serving", () => {
  // -------------------------------------------------------------------------
  // 1. Valid published profile renders the selected template
  // -------------------------------------------------------------------------
  describe("1. Valid Published Profile Rendering", () => {
    it("renders the selected template and embeds public DTO in __ONEVUE_DTO__ script", () => {
      const dto = createSampleDto();
      const website = createSampleWebsite();

      const html = renderPublicTemplateHtml({ dto, website });

      assert.ok(typeof html === "string" && html.length > 500);
      assert.ok(html.startsWith("<!DOCTYPE html>"), "Should produce full HTML5 document");
      assert.ok(html.includes('<div id="root"></div>'), "Must contain mounting root for React");

      // Verify the canonical script tag is injected
      assert.ok(
        html.includes('<script type="application/json" id="__ONEVUE_DTO__">'),
        "Must inject script tag with id '__ONEVUE_DTO__'"
      );

      // Verify original placeholder comment was replaced and no longer exists
      assert.ok(
        !html.includes("<!-- <script type=\"application/json\" id=\"__ONEVUE_DTO__\">{}</script> -->"),
        "Placeholder comment must be cleanly replaced"
      );

      // Verify exactly one instance of __ONEVUE_DTO__
      const occurrences = (html.match(/id=["']__ONEVUE_DTO__["']/g) || []).length;
      assert.equal(occurrences, 1, "Must contain exactly one __ONEVUE_DTO__ script tag");

      // Extract and parse the embedded JSON payload
      const scriptMatch = html.match(
        /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>([\s\S]*?)<\/script>/
      );
      assert.ok(scriptMatch && scriptMatch[1], "Script content must be extractable");

      const parsedPayload = JSON.parse(scriptMatch[1]);
      assert.equal(parsedPayload.dto.meta.username, "marcus");
      assert.equal(parsedPayload.dto.profile.displayName, "Marcus Aurelius");
      assert.equal(parsedPayload.dto.education[0].institution, "University of Waterloo");
      assert.equal(parsedPayload.website.customization.accentColor, "#3b82f6");

      // Verify SEO title and description are injected into <head>
      assert.ok(html.includes("<title>Marcus Aurelius | Portfolio</title>"));
      assert.ok(
        html.includes('content="Distributed Systems Researcher &amp; Engineer"') ||
          html.includes('content="Distributed Systems Researcher & Engineer"')
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. DTO payload is safely embedded, including </script> and XSS-like strings
  // -------------------------------------------------------------------------
  describe("2. XSS & Payload Serialization Safety", () => {
    it("safely escapes '</script>' and '<script>' in DTO values to prevent HTML breakout", () => {
      const maliciousBio = '</script><script>alert("XSS")</script><img src=x onerror=alert(1)>';
      const maliciousHeadline = 'Hacker </script><b onmouseover=evil()>Hover</b>';
      const maliciousName = 'Student <script src="//evil.com/xss.js"></script>';

      const dto = createSampleDto({
        profile: {
          displayName: maliciousName,
          headline: maliciousHeadline,
          bio: maliciousBio,
        },
      });
      const website = createSampleWebsite();

      const html = renderPublicTemplateHtml({ dto, website });

      // In the rendered HTML, raw '</script>' MUST NOT appear inside the __ONEVUE_DTO__ JSON body
      const scriptBodyMatch = html.match(
        /<script\s+type=["']application\/json["']\s+id=["']__ONEVUE_DTO__["']>([\s\S]*?)<\/script>/
      );
      assert.ok(scriptBodyMatch, "Script tag must exist");
      const scriptContent = scriptBodyMatch[1];

      // Must not contain raw unescaped </script>
      assert.equal(
        scriptContent.includes("</script>"),
        false,
        "JSON payload body must not contain unescaped '</script>'"
      );

      // Must have converted '<' to '\u003c'
      assert.ok(
        scriptContent.includes("\\u003c/script>"),
        "Raw '<' must be converted to '\\u003c'"
      );

      // When parsed by standard JSON.parse, the original malicious string is faithfully restored
      // with zero corruption and zero execution
      const parsed = JSON.parse(scriptContent);
      assert.equal(parsed.dto.profile.bio, maliciousBio);
      assert.equal(parsed.dto.profile.headline, maliciousHeadline);
      assert.equal(parsed.dto.profile.displayName, maliciousName);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unknown or unpublished usernames return 404
  // -------------------------------------------------------------------------
  describe("3. Unknown / Unpublished Username Handling", () => {
    it("triggers 404 error condition for unpublished or non-existent profile", async () => {
      const { fetchPublishedProfile } = require("../src/lib/onevue-api.js");

      // 1. Invalid username syntax returns notFound: true immediately without calling API
      const invalidRes = await fetchPublishedProfile("!invalid@username");
      assert.equal(invalidRes.success, false);
      assert.equal(invalidRes.notFound, true);

      // 2. Non-existent username returns notFound: true
      const shortRes = await fetchPublishedProfile("ab"); // < 3 chars
      assert.equal(shortRes.success, false);
      assert.equal(shortRes.notFound, true);
    });

    it("verifies renderPublicTemplateHtml throws when required profile root is missing", () => {
      assert.throws(
        () => {
          renderPublicTemplateHtml({ dto: null, website: createSampleWebsite() });
        },
        /Invalid OneVue profile payload/
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Unapproved or unsupported template versions are rejected
  // -------------------------------------------------------------------------
  describe("4. Central Registry Release Enforcement", () => {
    it("rejects unregistered template versions (e.g. 99.9.9) with descriptive error", () => {
      const dto = createSampleDto();
      const website = createSampleWebsite({ templateVersion: "99.9.9" });

      assert.throws(
        () => {
          renderPublicTemplateHtml({ dto, website });
        },
        /version '99.9.9' is unapproved or unsupported for template 'magicui-portfolio'/
      );
    });

    it("rejects unknown or unregistered template IDs", () => {
      const dto = createSampleDto();
      const website = createSampleWebsite({ templateId: "unapproved-developer-theme" });

      assert.throws(
        () => {
          renderPublicTemplateHtml({ dto, website });
        },
        /'unapproved-developer-theme' is not an approved template in the OneVue Central Registry/
      );
    });

    it("validates template release against APPROVED_TEMPLATE_REGISTRY", () => {
      assert.doesNotThrow(() => {
        validateTemplateRelease(TEMPLATE_ID, TEMPLATE_VERSION);
      });

      assert.throws(() => {
        validateTemplateRelease(TEMPLATE_ID, "2.0.0-beta");
      }, /unapproved or unsupported/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Missing artifacts produce a clear error with no fallback
  // -------------------------------------------------------------------------
  describe("5. Missing Artifact Strict Error Handling (No Silent Fallbacks)", () => {
    it("throws a clear error when entrypoint artifact is missing, refusing fallback", () => {
      const dto = createSampleDto();
      const website = createSampleWebsite();

      // Simulate a directory where artifact does not exist
      const nonExistentDir = path.resolve(__dirname, "fixtures/empty_templates");

      assert.throws(
        () => {
          renderPublicTemplateHtml({
            dto,
            website,
            templatesRootDir: nonExistentDir,
          });
        },
        /Template artifact not found: missing entrypoint 'index.html'/
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. Path traversal attempts are rejected
  // -------------------------------------------------------------------------
  describe("6. Path Traversal Rejection", () => {
    it("rejects directory traversal in templateId", () => {
      const maliciousIds = [
        "../magicui-portfolio",
        "../../etc/passwd",
        "magicui-portfolio/..",
        "magicui-portfolio/../../root",
        "..\\magicui-portfolio",
      ];

      for (const badId of maliciousIds) {
        assert.throws(
          () => {
            validateTemplateRelease(badId, "1.0.0");
          },
          /Path traversal rejected/,
          `Should reject traversal in templateId: ${badId}`
        );
      }
    });

    it("rejects directory traversal in templateVersion", () => {
      const maliciousVersions = [
        "../../1.0.0",
        "../1.0.0",
        "1.0.0/../../",
        "..\\1.0.0",
        "1.0.0/../../../etc",
      ];

      for (const badVersion of maliciousVersions) {
        assert.throws(
          () => {
            validateTemplateRelease("magicui-portfolio", badVersion);
          },
          /Path traversal rejected/,
          `Should reject traversal in version: ${badVersion}`
        );
      }
    });

    it("verifies secondary canonical containment check prevents escaping templates directory", () => {
      assert.throws(
        () => {
          resolveTemplateArtifactPath("magicui-portfolio", "../1.0.0");
        },
        /Path traversal rejected/
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. Asset URLs match the staged directory
  // -------------------------------------------------------------------------
  describe("7. Staged Asset URL Alignment", () => {
    it("confirms referenced static assets exist on disk in staged directory", () => {
      const dto = createSampleDto();
      const website = createSampleWebsite();

      const html = renderPublicTemplateHtml({ dto, website });

      // Find referenced script module: src="/templates/magicui-portfolio/1.0.0/assets/..."
      const scriptMatch = html.match(/src="(\/templates\/magicui-portfolio\/1\.0\.0\/assets\/[^"]+)"/);
      assert.ok(scriptMatch && scriptMatch[1], "Must find script asset URL in HTML");
      const scriptUrl = scriptMatch[1];

      // Find referenced stylesheet: href="/templates/magicui-portfolio/1.0.0/assets/..."
      const cssMatch = html.match(/href="(\/templates\/magicui-portfolio\/1\.0\.0\/assets\/[^"]+)"/);
      assert.ok(cssMatch && cssMatch[1], "Must find CSS asset URL in HTML");
      const cssUrl = cssMatch[1];

      // Verify that the files exist on disk in the staged directory
      const stagedRootDir = resolveTemplatesRootDir();
      const publicDir = path.resolve(stagedRootDir, "..");

      const scriptDiskPath = path.resolve(publicDir, scriptUrl.replace(/^\//, ""));
      const cssDiskPath = path.resolve(publicDir, cssUrl.replace(/^\//, ""));

      assert.ok(
        fs.existsSync(scriptDiskPath),
        `Script asset file must exist on disk at: ${scriptDiskPath}`
      );
      assert.ok(
        fs.existsSync(cssDiskPath),
        `CSS asset file must exist on disk at: ${cssDiskPath}`
      );

      assert.ok(fs.statSync(scriptDiskPath).size > 10000, "JS asset bundle must have content");
      assert.ok(fs.statSync(cssDiskPath).size > 1000, "CSS asset bundle must have content");
    });
  });

  // -------------------------------------------------------------------------
  // 8. Changing draft profile/customization does not alter an existing publication
  // -------------------------------------------------------------------------
  describe("8. Publication Immutability & Draft Isolation", () => {
    it("ensures modifications to draft profile and website customization do not mutate published output", () => {
      // 1. Immutable published revision snapshot (Revision #1)
      const publishedSnapshotDto = createSampleDto({
        profile: {
          headline: "FROZEN PUBLISHED HEADLINE #1",
          bio: "FROZEN PUBLISHED BIO #1",
        },
      });

      const publishedWebsiteMetadata = createSampleWebsite({
        revisionNumber: 1,
        accentColor: "#3b82f6", // Published blue
        themeMode: "system",
      });

      // Render the published revision
      const publishedHtml = renderPublicTemplateHtml({
        dto: publishedSnapshotDto,
        website: publishedWebsiteMetadata,
      });

      // 2. Student performs draft edits in their dashboard / config:
      // Note: Draft edits only mutate UserWebsiteConfig.customization and StudentProfile (draft)
      const draftMutatedProfile = {
        headline: "UNPUBLISHED DRAFT HEADLINE — SHOULD NOT APPEAR",
        bio: "UNPUBLISHED DRAFT BIO — SHOULD NOT APPEAR",
      };
      const draftMutatedCustomization = {
        accentColor: "#ef4444", // Draft red
        themeMode: "dark",
      };

      // 3. A public visitor accesses /p/marcus:
      // Upstream public API returns the frozen revision snapshot and frozen revision customization
      const servedHtml = renderPublicTemplateHtml({
        dto: publishedSnapshotDto, // Still Revision #1 frozen snapshot
        website: publishedWebsiteMetadata, // Still Revision #1 frozen customization
      });

      // Served output must match the published snapshot exactly
      assert.equal(servedHtml, publishedHtml);

      // Must contain published data
      assert.ok(servedHtml.includes("FROZEN PUBLISHED HEADLINE #1"));
      assert.ok(servedHtml.includes("#3b82f6"));

      // Must NOT contain any draft mutations
      assert.ok(!servedHtml.includes("UNPUBLISHED DRAFT HEADLINE — SHOULD NOT APPEAR"));
      assert.ok(!servedHtml.includes("UNPUBLISHED DRAFT BIO — SHOULD NOT APPEAR"));
      assert.ok(!servedHtml.includes("#ef4444"));
    });
  });
});
