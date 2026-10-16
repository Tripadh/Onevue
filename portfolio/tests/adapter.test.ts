import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptOneVueProfile,
  SUPPORTED_DTO_SCHEMA_VERSION,
} from "../src/lib/onevue-profile-adapter.ts";
import type {
  PublicProfileDTO_v1,
  WebsiteMetadata,
} from "../src/lib/onevue-profile-adapter.ts";

function createValidDTO(): PublicProfileDTO_v1 {
  return {
    meta: {
      schemaVersion: SUPPORTED_DTO_SCHEMA_VERSION,
      username: "alexrivera",
      canonicalUrl: "https://onevue.me/p/alexrivera",
      publishedAt: "2026-10-14T02:50:00.000Z",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
    },
    profile: {
      displayName: "Alex Rivera",
      preferredName: "Alex",
      initials: "AR",
      headline: "Full-Stack Engineer & AI Enthusiast",
      bio: "Passionate developer building developer tooling and high-scale systems.",
      profilePhoto: "https://example.com/avatar.png",
      location: {
        city: "San Francisco",
        state: "CA",
        country: "USA",
        formatted: "San Francisco, CA, USA",
      },
      nationality: "American",
      currentStatus: "Undergraduate Senior",
      careerInterests: ["Full-Stack", "Distributed Systems"],
      areasOfInterest: ["Web Performance", "Cloud Computing"],
      languages: [{ language: "English", proficiency: "native" }],
    },
    education: [
      {
        id: "edu_1",
        institution: "Stanford University",
        degree: "B.S.",
        fieldOfStudy: "Computer Science",
        startDate: "2022",
        endDate: "2026",
        currentStatus: "studying",
        website: "https://stanford.edu",
      },
    ],
    projects: [
      {
        id: "proj_1",
        title: "OneVue Core",
        shortDescription: "Decentralized digital identity platform",
        detailedDescription: "Full markdown description with architecture details.",
        projectType: "personal",
        startDate: "2025",
        endDate: "Present",
        technologies: ["Next.js", "TypeScript", "TailwindCSS"],
        liveUrl: "https://onevue.me",
        repoUrl: "https://github.com/onevue/core",
        videoUrl: "https://example.com/demo.mp4",
      },
      {
        id: "proj_2",
        title: "Acme Summer Internship",
        shortDescription: "Built internal microservices",
        projectType: "internship",
        role: "Software Engineering Intern",
        startDate: "June 2024",
        endDate: "August 2024",
        technologies: ["Go", "Docker", "PostgreSQL"],
        repoUrl: "https://github.com/acme/internship",
      },
    ],
    skills: [
      { id: "skill_1", name: "TypeScript", category: "Languages", proficiency: "Advanced" },
      { id: "skill_2", name: "React", category: "Frameworks", proficiency: "Expert" },
      { id: "skill_3", name: "Next.js", category: "Frameworks", proficiency: "Advanced" },
    ],
    credentials: [
      {
        id: "cred_1",
        title: "AWS Certified Developer",
        credentialType: "certification",
        issuer: "Amazon Web Services",
        credentialUrl: "https://aws.amazon.com",
      },
    ],
    achievements: [
      {
        id: "ach_1",
        title: "CalHacks 11.0 Winner",
        category: "hackathon",
        organization: "UC Berkeley",
        date: "Oct 2025",
        description: "Won 1st place in AI Track",
        awardPrize: "1st Place Grand Prize",
        proofUrl: "https://devpost.com/software/calhacks-winner",
      },
      {
        id: "ach_2",
        title: "Dean's Honor List",
        category: "academic",
        date: "2023",
      },
    ],
    resume: {
      url: "https://example.com/alex_resume.pdf",
      fileName: "Alex_Rivera_Resume.pdf",
    },
    media: [],
    contact: {
      email: "alex@example.com",
      phone: "+1 555-0199",
      github: "https://github.com/alexrivera",
      linkedin: "https://linkedin.com/in/alexrivera",
      twitter: "https://x.com/alexrivera",
      socialLinks: [
        {
          id: "soc_1",
          platform: "Discord",
          url: "https://discord.gg/onevue",
          category: "community",
          isPrimary: true,
        },
      ],
    },
  };
}

function createValidWebsite(): WebsiteMetadata {
  return {
    username: "alexrivera",
    templateId: "magicui-portfolio",
    templateVersion: "1.0.0",
    publishedAt: "2026-10-14T02:50:00.000Z",
    revisionNumber: 1,
    customization: {
      accentColor: "#3b82f6",
      themeMode: "system",
      visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
    },
  };
}

describe("OneVue Magic UI Profile Adapter", () => {
  it("correctly maps a full valid PublicProfileDTO_v1 into adapted portfolio data", () => {
    const dto = createValidDTO();
    const website = createValidWebsite();

    const adapted = adaptOneVueProfile(dto, website);

    assert.equal(adapted.name, "Alex Rivera");
    assert.equal(adapted.initials, "AR");
    assert.equal(adapted.description, "Full-Stack Engineer & AI Enthusiast");
    assert.equal(adapted.summary, "Passionate developer building developer tooling and high-scale systems.");
    assert.equal(adapted.avatarUrl, "https://example.com/avatar.png");
    assert.equal(adapted.location, "San Francisco, CA, USA");
    assert.equal(adapted.url, "https://onevue.me/p/alexrivera");

    // Education
    assert.equal(adapted.education.length, 1);
    assert.equal(adapted.education[0].school, "Stanford University");
    assert.equal(adapted.education[0].degree, "B.S. in Computer Science");
    assert.equal(adapted.education[0].start, "2022");
    assert.equal(adapted.education[0].end, "2026");
    assert.equal(adapted.education[0].href, "https://stanford.edu");

    // Projects
    assert.equal(adapted.projects.length, 2);
    assert.equal(adapted.projects[0].title, "OneVue Core");
    assert.equal(adapted.projects[0].href, "https://onevue.me");
    assert.deepEqual(adapted.projects[0].technologies, ["Next.js", "TypeScript", "TailwindCSS"]);
    assert.equal(adapted.projects[0].video, "https://example.com/demo.mp4");
    assert.equal(adapted.projects[0].links.length, 3); // Website, Source, Video

    // Skills
    assert.equal(adapted.skills.length, 3);
    assert.equal(adapted.skills[0].name, "TypeScript");

    // Hackathons (strictly category contains hackathon)
    assert.equal(adapted.hackathons.length, 1);
    assert.equal(adapted.hackathons[0].title, "CalHacks 11.0 Winner");
    assert.equal(adapted.hackathons[0].location, "UC Berkeley");
    assert.equal(adapted.hackathons[0].links.length, 1);
    assert.equal(adapted.hackathons[0].links[0].title, "1st Place Grand Prize");

    // Social Links
    assert.ok(adapted.contact.social["GitHub"]);
    assert.equal(adapted.contact.social["GitHub"].url, "https://github.com/alexrivera");
    assert.ok(adapted.contact.social["LinkedIn"]);
    assert.ok(adapted.contact.social["X"]);
    assert.ok(adapted.contact.social["Discord"]);
  });

  it("strictly enforces non-fabrication of formal work experience", () => {
    const dto = createValidDTO();
    // Only proj_2 has projectType: "internship"
    const adapted = adaptOneVueProfile(dto, createValidWebsite());

    // Fictitious employment should NOT be created from personal projects (proj_1)
    assert.equal(adapted.work.length, 1);
    assert.equal(adapted.work[0].company, "Acme Summer Internship");
    assert.equal(adapted.work[0].title, "Software Engineering Intern");

    // If no projects are internships, work must be empty
    const dtoNoInternship = createValidDTO();
    dtoNoInternship.projects = [dto.projects[0]]; // only personal project
    const adaptedNoWork = adaptOneVueProfile(dtoNoInternship, createValidWebsite());
    assert.equal(adaptedNoWork.work.length, 0);
    assert.equal(adaptedNoWork.visibleSections.work, false);
  });

  it("does not mutate the input DTO object", () => {
    const dto = createValidDTO();
    const originalJson = JSON.stringify(dto);

    adaptOneVueProfile(dto, createValidWebsite());

    assert.equal(JSON.stringify(dto), originalJson);
  });

  it("handles empty arrays and optional missing fields gracefully", () => {
    const minimalDTO: PublicProfileDTO_v1 = {
      meta: {
        schemaVersion: SUPPORTED_DTO_SCHEMA_VERSION,
        username: "minimalist",
      },
      profile: {
        displayName: "Minimal User",
        initials: "MU",
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
      contact: {
        socialLinks: [],
      },
    };

    const adapted = adaptOneVueProfile(minimalDTO, {
      username: "minimalist",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      publishedAt: new Date().toISOString(),
      revisionNumber: 1,
      customization: { visibleSections: ["about", "projects", "education"] },
    });

    assert.equal(adapted.name, "Minimal User");
    assert.equal(adapted.initials, "MU");
    assert.equal(adapted.description, "");
    assert.equal(adapted.summary, "");
    assert.equal(adapted.education.length, 0);
    assert.equal(adapted.projects.length, 0);
    assert.equal(adapted.work.length, 0);
    assert.equal(adapted.skills.length, 0);
    assert.equal(adapted.hackathons.length, 0);

    // Empty sections are hidden
    assert.equal(adapted.visibleSections.about, false);
    assert.equal(adapted.visibleSections.projects, false);
    assert.equal(adapted.visibleSections.education, false);
    assert.equal(adapted.visibleSections.skills, false);
    assert.equal(adapted.visibleSections.work, false);

    // Missing contact fields never synthesize demo contacts
    assert.equal(adapted.contact.email, undefined);
    assert.equal(adapted.contact.tel, undefined);
    assert.deepEqual(adapted.contact.social, {});
  });

  it("rejects unsupported schema versions with a descriptive error", () => {
    const invalidDTO = createValidDTO();
    (invalidDTO.meta as any).schemaVersion = "2.0.0";

    assert.throws(
      () => adaptOneVueProfile(invalidDTO, createValidWebsite()),
      /Unsupported profile schema version: '2.0.0'/
    );
  });

  it("rejects null or malformed DTO payloads", () => {
    assert.throws(
      () => adaptOneVueProfile(null as any),
      /Invalid OneVue profile payload/
    );

    assert.throws(
      () => adaptOneVueProfile({} as any),
      /Invalid OneVue profile payload/
    );
  });

  it("strictly honors website.customization.visibleSections", () => {
    const dto = createValidDTO();
    const website = createValidWebsite();
    website.customization.visibleSections = ["projects", "contact"]; // education, skills, achievements disabled

    const adapted = adaptOneVueProfile(dto, website);

    assert.equal(adapted.visibleSections.projects, true);
    assert.equal(adapted.visibleSections.contact, true);
    assert.equal(adapted.visibleSections.education, false);
    assert.equal(adapted.visibleSections.skills, false);
    assert.equal(adapted.visibleSections.hackathons, false);
    assert.equal(adapted.visibleSections.about, false);
  });

  it("never injects static demo profile data into adapted real profile data", () => {
    const dto = createValidDTO();
    const adapted = adaptOneVueProfile(dto, createValidWebsite());

    // Must never leak Dillion Verma's details
    assert.notEqual(adapted.name, "Dillion Verma");
    assert.notEqual(adapted.initials, "DV");
    assert.notEqual(adapted.url, "https://dillion.io");
    assert.notEqual(adapted.contact.email, "hello@example.com");
    assert.ok(!JSON.stringify(adapted).includes("buildspace sf1"));
    assert.ok(!JSON.stringify(adapted).includes("Atomic Finance"));
  });

  it("strictly rejects unsafe URL protocols (javascript:, data:, vbscript:) in all fields", () => {
    const maliciousDTO = createValidDTO();
    maliciousDTO.profile.profilePhoto = "javascript:alert('xss')";
    maliciousDTO.education[0].website = "data:text/html;base64,PHNjcmlwdD4=";
    maliciousDTO.projects[0].liveUrl = "javascript:void(0)";
    maliciousDTO.projects[0].repoUrl = "vbscript:malicious";
    maliciousDTO.achievements[0].proofUrl = "javascript:exploit()";
    maliciousDTO.contact.github = "data:text/plain,hacked";
    maliciousDTO.contact.socialLinks = [
      {
        id: "bad_soc",
        platform: "Custom",
        url: "javascript:evil()",
        category: "social",
      },
    ];

    const adapted = adaptOneVueProfile(maliciousDTO, createValidWebsite());

    // Avatar must be stripped
    assert.equal(adapted.avatarUrl, undefined);

    // Education href must default to safe fallback "#"
    assert.equal(adapted.education[0].href, "#");

    // Project links must omit javascript/vbscript links
    assert.equal(adapted.projects[0].links.length, 1); // only valid videoUrl
    assert.equal(adapted.projects[0].href, "#");

    // Hackathon links must omit javascript proof
    assert.equal(adapted.hackathons[0].links.length, 0);

    // Malicious github and custom social link must not be present in social map
    assert.equal(adapted.contact.social["GitHub"], undefined);
    assert.equal(adapted.contact.social["Custom"], undefined);
  });
});
