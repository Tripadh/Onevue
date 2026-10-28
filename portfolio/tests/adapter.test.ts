import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptOneVueProfile,
  resolveAvatarUrl,
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
  it("passes accent, theme, and section order through to the renderer", () => {
    const website = createValidWebsite();
    website.customization.accentColor = "#10b981";
    website.customization.themeMode = "light";
    website.customization.sectionOrder = ["contact", "skills", "not-a-section"];
    const adapted = adaptOneVueProfile(createValidDTO(), website);
    assert.equal(adapted.accentColor, "#10b981");
    assert.equal(adapted.themeMode, "light");
    assert.equal(adapted.sectionOrder[0], "contact");
    assert.equal(adapted.sectionOrder[1], "skills");
    assert.equal(adapted.sectionOrder.includes("not-a-section"), false);
    assert.equal(adapted.sectionOrder.includes("about"), true);
  });

  it("correctly maps a full valid PublicProfileDTO_v1 into adapted portfolio data", () => {
    const dto = createValidDTO();
    const website = createValidWebsite();

    const adapted = adaptOneVueProfile(dto, website);

    assert.equal(adapted.name, "Alex Rivera");
    assert.equal(adapted.initials, "AR");
    assert.equal(adapted.description, "Full-Stack Engineer & AI Enthusiast");
    assert.equal(adapted.summary, "Passionate developer building developer tooling and high-scale systems.");
    assert.equal(adapted.avatarUrl, "https://example.com/avatar.png");
    assert.equal(
      resolveAvatarUrl("/api/profile/photo/user_abc_1710000000000_0123456789abcdef.jpg", "http://localhost:3000"),
      "http://localhost:3000/api/profile/photo/user_abc_1710000000000_0123456789abcdef.jpg"
    );
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

  it("renders schema 1.0.0 snapshots that stored identity data in achievements", () => {
    const dto = createValidDTO();
    delete (dto as { experience?: unknown }).experience;
    delete (dto as { testimonials?: unknown }).testimonials;
    delete (dto as { team?: unknown }).team;
    dto.achievements.push(
      {
        id: "exp_old",
        title: "Engineer at Initech",
        category: "experience",
        organization: "Initech",
        role: "Engineer",
        date: "2018 – 2020",
        description: "Shipped billing",
      },
      {
        id: "quote_old",
        title: "“Great work”",
        category: "testimonial",
        organization: "Ada",
        role: "Client",
        description: "Self-reported testimonial",
      },
      {
        id: "team_old",
        title: "Shown",
        category: "team",
        role: "CEO",
      }
    );

    const adapted = adaptOneVueProfile(dto, createValidWebsite());

    assert.equal(adapted.work.some((item) => item.company === "Initech" && item.title === "Engineer"), true);
    assert.equal(adapted.work.some((item) => item.company === "Acme Summer Internship"), true);
    assert.equal(adapted.testimonials[0].author, "Ada");
    assert.equal(adapted.testimonials[0].quote, "Great work");
    assert.equal(adapted.team[0].name, "Shown");
    assert.equal(adapted.team[0].role, "CEO");
    assert.equal(adapted.credentials[0].title, "AWS Certified Developer");
    assert.equal(adapted.highlights.some((item) => item.title === "Dean's Honor List"), true);
    assert.equal(adapted.hackathons.length, 1);
    assert.equal(adapted.education[0].school, "Stanford University");
    assert.equal(adapted.projects.some((item) => item.title === "OneVue Core"), true);
  });

  it("renders employment, services, products, case studies, featured content, and testimonials from optional fields", () => {
    const dto = createValidDTO();
    dto.experience = [
      {
        id: "job_1",
        title: "Staff Engineer",
        organization: "Acme Cloud",
        startDate: "2021-04",
        isCurrent: true,
        description: "Owns the platform",
      },
    ];
    dto.testimonials = [
      { id: "quote_1", quote: "Excellent", authorName: "Jamie", relationship: "Client", attribution: "self-reported" },
    ];
    dto.team = [{ id: "member_1", name: "Public Lead", role: "Founder" }];
    dto.projects.push(
      {
        id: "prod_1",
        title: "Lamp",
        projectType: "product",
        technologies: [],
        shortDescription: "USD 80",
        imageUrl: "https://cdn.example/lamp.jpg",
      },
      {
        id: "svc_1",
        title: "Logo design",
        projectType: "service",
        technologies: [],
        shortDescription: "A wordmark",
      },
      {
        id: "case_1",
        title: "Rebrand",
        projectType: "case-study",
        technologies: [],
        shortDescription: "A new identity",
      },
      {
        id: "feat_1",
        title: "Launch essay",
        projectType: "featured",
        technologies: [],
        liveUrl: "https://cora.example/launch",
        imageUrl: "https://cdn.example/cora.jpg",
      }
    );

    const adapted = adaptOneVueProfile(dto, createValidWebsite());

    assert.equal(adapted.work[0].company, "Acme Cloud");
    assert.equal(adapted.work[0].title, "Staff Engineer");
    assert.equal(adapted.work[0].end, "Present");
    assert.equal(adapted.services[0].title, "Logo design");
    assert.equal(adapted.products[0].title, "Lamp");
    assert.equal(adapted.products[0].image, "https://cdn.example/lamp.jpg");
    assert.equal(adapted.caseStudies[0].title, "Rebrand");
    assert.equal(adapted.featured[0].title, "Launch essay");
    assert.equal(adapted.featured[0].image, "https://cdn.example/cora.jpg");
    assert.equal(adapted.featured[0].href, "https://cora.example/launch");
    assert.equal(adapted.testimonials[0].quote, "Excellent");
    assert.equal(adapted.team[0].name, "Public Lead");
    assert.equal(adapted.projects.some((item) => item.title === "Lamp"), false);
    assert.equal(adapted.visibleSections.credentials, true);
  });

  it("preserves a safe project image and omits an unsafe or missing one", () => {
    const dto = createValidDTO();
    const assetPath = "/api/assets/public/ast_" + "a".repeat(24);
    dto.projects[0].imageUrl = assetPath;
    dto.projects[1].imageUrl = "javascript:alert(1)";
    dto.media = [
      {
        id: "project_asset_0",
        mediaUrl: "https://cdn.example/should-not-override.png",
        mediaType: "image",
        title: "Ignored",
        category: "project",
      },
      {
        id: "media_1",
        mediaUrl: "https://cdn.example/reel.mp4",
        mediaType: "video",
        title: "Show reel",
        category: "project",
      },
    ];

    const adapted = adaptOneVueProfile(dto, createValidWebsite(), { assetOrigin: "http://localhost:3000" });
    const core = adapted.projects.find((item) => item.title === "OneVue Core");
    const internship = adapted.projects.find((item) => item.title === "Acme Summer Internship");

    assert.ok(core);
    assert.equal(core.image, `http://localhost:3000${assetPath}`);
    assert.ok(internship);
    assert.equal(internship.image, "");
    assert.equal(adapted.media.some((item) => item.title === "Show reel"), true);
    assert.equal(adapted.media.some((item) => item.href.includes("should-not-override")), false);

    const legacy = createValidDTO();
    delete legacy.projects[0].imageUrl;
    legacy.media = [
      {
        id: "project_asset_0",
        mediaUrl: "https://cdn.example/legacy.png",
        mediaType: "image",
        title: "Legacy cover",
        category: "project",
      },
    ];
    const fromLegacy = adaptOneVueProfile(legacy, createValidWebsite());
    assert.equal(fromLegacy.projects[0].image, "https://cdn.example/legacy.png");
    assert.equal(fromLegacy.media.length, 0);
  });

  it("does not throw when optional identity fields are missing or empty", () => {
    const dto = createValidDTO();
    dto.projects = [{ id: "empty", title: "Notes", technologies: [] }];
    dto.credentials = [];
    dto.achievements = [];
    dto.media = [];
    (dto as { experience?: unknown }).experience = [];
    (dto as { testimonials?: unknown }).testimonials = [{ id: "bad", quote: "", authorName: "" }];
    (dto as { team?: unknown }).team = [{ id: "nobody", name: "" }];

    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(adapted.projects[0].title, "Notes");
    assert.equal(adapted.projects[0].image, "");
    assert.equal(adapted.services.length, 0);
    assert.equal(adapted.credentials.length, 0);
    assert.equal(adapted.testimonials.length, 0);
    assert.equal(adapted.team.length, 0);
    assert.equal(adapted.media.length, 0);
    assert.equal(adapted.visibleSections.services, false);
    assert.equal(adapted.visibleSections.team, false);
  });

  it("keeps stored profile fields the test adapter does not render", () => {
    const dto = createValidDTO();
    const before = JSON.stringify(dto);
    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(JSON.stringify(dto), before);
    assert.equal(adapted.templateId, "magicui-portfolio");
    assert.ok(adapted.retainedFields.includes("profile.languages"));
    assert.ok(adapted.retainedFields.includes("profile.careerInterests"));
    assert.ok(adapted.retainedFields.includes("profile.nationality"));
    assert.equal(dto.profile.languages[0].language, "English");
  });

  it("renders public education custom fields and drops unsafe or hidden ones", () => {
    const dto = createValidDTO();
    dto.customSections = [
      {
        id: "sec_education01",
        key: "education",
        title: "Education",
        builtinKey: "education",
        order: 0,
        repeatable: true,
        records: [
          {
            id: "edu_1",
            fields: [
              { id: "fld_area000001", key: "research_area", label: "Research area", type: "text", order: 0, presentation: "inline", value: "Graphics" },
              { id: "fld_bad0000001", key: "bad", label: "Bad", type: "url", order: 1, presentation: "link", value: "javascript:alert(1)" },
              { id: "fld_hide000001", key: "diagram", label: "Diagram", type: "image", order: 2, presentation: "hidden", value: { href: "https://cdn.example/diagram.png" } },
            ],
          },
        ],
      },
      {
        id: "sec_custom0001",
        key: "press",
        title: "Press",
        order: 1,
        repeatable: true,
        records: [{ id: "ent_1", fields: [{ id: "fld_note000001", key: "note", label: "Note", type: "text", order: 0, presentation: "inline", value: "Featured" }] }],
      },
    ];
    const before = JSON.stringify(dto);
    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(JSON.stringify(dto), before);
    assert.equal(adapted.education[0].customFields?.length, 1);
    assert.equal(adapted.education[0].customFields?.[0].text, "Graphics");
    assert.equal(adapted.customSections.length, 1);
    assert.equal(adapted.customSections[0].title, "Press");
    assert.equal(adapted.visibleSections.custom, true);
  });

  it("renders a linked certificate image inside the AWS credential and not as a second card", () => {
    const dto = createValidDTO();
    dto.credentials = [
      {
        id: "crd_aws",
        title: "AWS Cloud Practitioner",
        credentialType: "certification",
        issuer: "Amazon Web Services",
        issueDate: "2024-05-01",
        credentialUrl: "https://aws.amazon.com/certification",
      },
    ];
    dto.customSections = [
      {
        id: "sec_cred000001",
        key: "credentials",
        title: "Credentials",
        builtinKey: "credentials",
        order: 0,
        repeatable: true,
        records: [
          {
            id: "crd_aws",
            fields: [
              {
                id: "fld_image00001",
                key: "certificate_image",
                label: "Certificate image",
                type: "image",
                order: 0,
                presentation: "image",
                value: { href: "https://cdn.example/aws.png", fileName: "aws.png" },
              },
            ],
          },
        ],
      },
      {
        id: "sec_custom0001",
        key: "press",
        title: "Press",
        order: 1,
        repeatable: true,
        records: [{ id: "ent_1", fields: [{ id: "fld_note000001", key: "note", label: "Note", type: "text", order: 0, presentation: "inline", value: "Featured" }] }],
      },
    ];
    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(adapted.credentials.length, 1);
    assert.equal(adapted.credentials[0].id, "crd_aws");
    assert.equal(adapted.credentials[0].title, "AWS Cloud Practitioner");
    assert.equal(adapted.credentials[0].customFields?.length, 1);
    assert.equal(adapted.credentials[0].customFields?.[0].href, "https://cdn.example/aws.png");
    assert.equal(adapted.customSections.length, 1);
    assert.equal(adapted.customSections[0].title, "Press");
    dto.credentials[0].title = "AWS Certified Cloud Practitioner";
    const renamed = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(renamed.credentials[0].title, "AWS Certified Cloud Practitioner");
    assert.equal(renamed.credentials[0].customFields?.[0].href, "https://cdn.example/aws.png");
  });

  it("places linked fields on the existing work, testimonial, team, link, media, and about records", () => {
    const dto = createValidDTO();
    dto.experience = [
      { id: "currentEmployment", title: "Lead", organization: "Globex", isCurrent: true },
      { id: "job_1", title: "Engineer", organization: "Initech" },
    ];
    dto.testimonials = [{ id: "t_1", quote: "Excellent", authorName: "Ada", relationship: "Client" }];
    dto.team = [{ id: "team_1", name: "Mina", role: "CEO" }];
    dto.media = [{ id: "sample_1", mediaUrl: "https://cdn.example/reel.mp4", mediaType: "video", title: "Reel", category: "work-sample" }];
    dto.contact.socialLinks = [{ id: "lnk_1", platform: "LeetCode", url: "https://leetcode.com/ada", category: "coding" }];
    dto.customSections = [
      {
        id: "sec_job",
        key: "current",
        title: "Current employment",
        builtinKey: "currentEmployment",
        order: 0,
        repeatable: false,
        records: [{ id: "", fields: [{ id: "fld_note", key: "note", label: "Team note", type: "text", order: 0, presentation: "inline", value: "Platform" }] }],
      },
      {
        id: "sec_hist",
        key: "history",
        title: "Employment history",
        builtinKey: "employmentHistory",
        order: 1,
        repeatable: true,
        records: [{ id: "job_1", fields: [{ id: "fld_badge", key: "badge", label: "Badge", type: "text", order: 0, presentation: "inline", value: "Senior" }] }],
      },
      {
        id: "sec_t",
        key: "testimonials",
        title: "Testimonials",
        builtinKey: "testimonials",
        order: 2,
        repeatable: true,
        records: [{ id: "t_1", fields: [{ id: "fld_src", key: "source", label: "Source", type: "text", order: 0, presentation: "inline", value: "Call" }] }],
      },
      {
        id: "sec_team",
        key: "team",
        title: "Team",
        builtinKey: "team",
        order: 3,
        repeatable: true,
        records: [{ id: "team_1", fields: [{ id: "fld_focus", key: "focus", label: "Focus", type: "text", order: 0, presentation: "inline", value: "Product" }] }],
      },
      {
        id: "sec_link",
        key: "links",
        title: "Links",
        builtinKey: "links",
        order: 4,
        repeatable: true,
        records: [{ id: "lnk_1", fields: [{ id: "fld_pin", key: "pin", label: "Pin", type: "text", order: 0, presentation: "inline", value: "Main" }] }],
      },
      {
        id: "sec_sample",
        key: "samples",
        title: "Work samples",
        builtinKey: "workSamples",
        order: 5,
        repeatable: true,
        records: [{ id: "sample_1", fields: [{ id: "fld_cap", key: "caption", label: "Caption", type: "text", order: 0, presentation: "inline", value: "Showreel" }] }],
      },
      {
        id: "sec_about",
        key: "about",
        title: "About",
        builtinKey: "about",
        order: 6,
        repeatable: false,
        records: [{ id: "", fields: [{ id: "fld_pronouns", key: "pronouns", label: "Pronouns", type: "text", order: 0, presentation: "inline", value: "they/them" }] }],
      },
      {
        id: "sec_press",
        key: "press",
        title: "Press",
        order: 7,
        repeatable: true,
        records: [{ id: "ent_1", fields: [{ id: "fld_mention", key: "mention", label: "Mention", type: "text", order: 0, presentation: "inline", value: "Featured" }] }],
      },
    ];
    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(adapted.work[0].customFields?.[0].text, "Platform");
    assert.equal(adapted.work[1].customFields?.[0].text, "Senior");
    assert.equal(adapted.work[1].company, "Initech");
    dto.experience[1].title = "Staff Engineer";
    const renamed = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(renamed.work[1].title, "Staff Engineer");
    assert.equal(renamed.work[1].customFields?.[0].text, "Senior");
    assert.equal(adapted.testimonials[0].customFields?.[0].text, "Call");
    assert.equal(adapted.team[0].customFields?.[0].text, "Product");
    assert.equal(adapted.contact.social.LeetCode.customFields?.[0].text, "Main");
    assert.equal(adapted.media[0].customFields?.[0].text, "Showreel");
    assert.equal(adapted.aboutFields?.[0].text, "they/them");
    assert.equal(adapted.customSections.length, 1);
    assert.equal(adapted.customSections[0].title, "Press");
  });

  it("keeps internship custom fields on the source project id across rename, reorder, and rollback", () => {
    const dto = createValidDTO();
    dto.experience = [];
    dto.projects = [
      {
        id: "proj_intern",
        title: "Acme Internship",
        projectType: "internship",
        role: "Intern",
        technologies: [],
        shortDescription: "Billing",
      },
      {
        id: "proj_job",
        title: "Campus Job",
        projectType: "employment",
        role: "Assistant",
        technologies: [],
        shortDescription: "Desk",
      },
      {
        id: "",
        title: "Untitled internship",
        projectType: "internship",
        role: "Intern",
        technologies: [],
      },
    ];
    dto.customSections = [
      {
        id: "sec_projects",
        key: "projects",
        title: "Projects",
        builtinKey: "projects",
        order: 0,
        repeatable: true,
        records: [
          {
            id: "proj_intern",
            fields: [{ id: "fld_team", key: "team", label: "Team", type: "text", order: 0, presentation: "inline", value: "Payments" }],
          },
          {
            id: "proj_job",
            fields: [{ id: "fld_desk", key: "desk", label: "Desk", type: "text", order: 0, presentation: "inline", value: "Front" }],
          },
        ],
      },
    ];
    const published = JSON.parse(JSON.stringify(dto));
    const adapted = adaptOneVueProfile(published, createValidWebsite());
    const intern = adapted.work.find((item) => item.sourceRecordId === "proj_intern");
    const job = adapted.work.find((item) => item.sourceRecordId === "proj_job");
    const missing = adapted.work.find((item) => item.company === "Untitled internship");
    assert.equal(intern?.customFields?.[0].id, "fld_team");
    assert.equal(intern?.customFields?.[0].text, "Payments");
    assert.equal(job?.customFields?.[0].text, "Front");
    assert.equal(job?.customFields?.[0].id, "fld_desk");
    assert.equal(missing?.customFields?.length || 0, 0);
    assert.equal(adapted.projects.filter((item) => item.title === "Acme Internship").length, 1);
    assert.equal(JSON.stringify(published.customSections), JSON.stringify(dto.customSections));

    published.projects = [published.projects[2], published.projects[1], { ...published.projects[0], title: "Acme Internship Renamed" }];
    const renamed = adaptOneVueProfile(published, createValidWebsite());
    assert.equal(renamed.work.find((item) => item.sourceRecordId === "proj_intern")?.company, "Acme Internship Renamed");
    assert.equal(renamed.work.find((item) => item.sourceRecordId === "proj_intern")?.customFields?.[0].text, "Payments");
    assert.equal(renamed.work.find((item) => item.sourceRecordId === "proj_job")?.customFields?.[0].text, "Front");

    const prior = JSON.parse(JSON.stringify(dto));
    prior.customSections = [];
    const rolled = adaptOneVueProfile(prior, createValidWebsite());
    assert.equal(rolled.work.find((item) => item.sourceRecordId === "proj_intern")?.customFields?.length || 0, 0);
    assert.deepEqual(prior.customSections, []);
    assert.equal(adapted.work.find((item) => item.sourceRecordId === "proj_intern")?.customFields?.[0].text, "Payments");
  });

  it("renders legacy achievement snapshots once and leaves unknown section keys unused", () => {
    const dto = createValidDTO();
    delete (dto as { experience?: unknown }).experience;
    delete (dto as { testimonials?: unknown }).testimonials;
    delete (dto as { team?: unknown }).team;
    dto.projects = dto.projects.filter((item) => item.projectType !== "internship" && item.projectType !== "employment");
    dto.achievements.push(
      {
        id: "exp_old",
        title: "Engineer at Initech",
        category: "experience",
        organization: "Initech",
        role: "Engineer",
        description: "Shipped billing",
      },
      {
        id: "quote_old",
        title: "“Great work”",
        category: "testimonial",
        organization: "Ada",
        role: "Client",
        description: "Self-reported",
      },
      {
        id: "team_old",
        title: "Shown",
        category: "team",
        role: "CEO",
      }
    );
    dto.customSections = [
      {
        id: "sec_highlights",
        key: "highlights",
        title: "Highlights",
        builtinKey: "highlights",
        order: 0,
        repeatable: true,
        records: [
          {
            id: "exp_old",
            fields: [{ id: "fld_old_note", key: "note", label: "Note", type: "text", order: 0, presentation: "inline", value: "Legacy role" }],
          },
          {
            id: "quote_old",
            fields: [{ id: "fld_old_quote", key: "source", label: "Source", type: "text", order: 0, presentation: "inline", value: "Email" }],
          },
          {
            id: "team_old",
            fields: [{ id: "fld_old_team", key: "focus", label: "Focus", type: "text", order: 0, presentation: "inline", value: "Product" }],
          },
        ],
      },
      {
        id: "sec_mystery",
        key: "mystery",
        title: "Mystery",
        builtinKey: "mystery",
        order: 1,
        repeatable: true,
        records: [
          {
            id: "exp_old",
            fields: [{ id: "fld_mystery", key: "mystery", label: "Mystery", type: "text", order: 0, presentation: "inline", value: "Do not attach" }],
          },
        ],
      },
    ];
    const snapshot = JSON.parse(JSON.stringify(dto));
    const adapted = adaptOneVueProfile(snapshot, createValidWebsite());
    const legacyJob = adapted.work.filter((item) => item.sourceRecordId === "exp_old");
    assert.equal(legacyJob.length, 1);
    assert.equal(legacyJob[0].customFields?.length, 1);
    assert.equal(legacyJob[0].customFields?.[0].text, "Legacy role");
    assert.equal(adapted.work.some((item) => item.customFields?.some((field) => field.text === "Do not attach")), false);
    assert.equal(adapted.testimonials.filter((item) => item.author === "Ada").length, 1);
    assert.equal(adapted.testimonials.length, 1);
    assert.equal(adapted.testimonials[0].customFields?.length, 1);
    assert.equal(adapted.testimonials[0].customFields?.[0].text, "Email");
    assert.equal(adapted.team.filter((item) => item.name === "Shown").length, 1);
    assert.equal(adapted.team[0].customFields?.length, 1);
    assert.equal(adapted.team[0].customFields?.[0].text, "Product");
    assert.equal(adapted.highlights.some((item) => item.title === "Engineer at Initech"), false);
    assert.equal(adapted.customSections.some((section) => section.title === "Mystery"), false);
    assert.equal(JSON.stringify(snapshot.achievements), JSON.stringify(dto.achievements));

    const ambiguous = JSON.parse(JSON.stringify(dto));
    ambiguous.customSections.push({
      id: "sec_highlights_2",
      key: "highlights",
      title: "Highlights copy",
      order: 3,
      repeatable: true,
      records: [
        {
          id: "exp_old",
          fields: [{ id: "fld_other", key: "other", label: "Other", type: "text", order: 0, presentation: "inline", value: "Ambiguous" }],
        },
      ],
    });
    const unclear = adaptOneVueProfile(ambiguous, createValidWebsite());
    assert.equal(unclear.work.find((item) => item.sourceRecordId === "exp_old")?.customFields?.length || 0, 0);

    const current = JSON.parse(JSON.stringify(dto));
    current.experience = [{ id: "job_real", title: "Lead", organization: "Globex" }];
    const explicit = adaptOneVueProfile(current, createValidWebsite());
    assert.equal(explicit.work.some((item) => item.sourceRecordId === "exp_old"), false);
    assert.equal(explicit.work.some((item) => item.customFields?.some((field) => field.text === "Legacy role")), false);
    assert.equal(explicit.work[0].company, "Globex");
  });

  it("renders social custom fields on the matching link and keeps navbar icons", () => {
    const dto = createValidDTO();
    dto.contact.github = "https://github.com/alexrivera";
    dto.contact.socialLinks = [
      { id: "lnk_main", platform: "GitHub", url: "https://github.com/alexrivera", category: "social", isPrimary: true },
      { id: "lnk_other", platform: "GitHub", url: "https://github.com/other", category: "social" },
      { id: "lnk_site", platform: "LeetCode", url: "https://leetcode.com/ada", category: "coding" },
    ];
    dto.customSections = [
      {
        id: "sec_links",
        key: "links",
        title: "Links",
        builtinKey: "links",
        order: 0,
        repeatable: true,
        records: [
          {
            id: "lnk_main",
            fields: [
              { id: "fld_primary", key: "pin", label: "Pin", type: "text", order: 0, presentation: "inline", value: "Primary" },
              { id: "fld_secret", key: "secret", label: "Secret", type: "text", order: 1, presentation: "inline", visibility: "private", value: "hidden" },
              { id: "fld_blank", key: "blank", label: "Blank", type: "text", order: 2, presentation: "inline", value: "" },
            ],
          },
          {
            id: "lnk_other",
            fields: [{ id: "fld_other", key: "pin", label: "Pin", type: "text", order: 0, presentation: "inline", value: "Other account" }],
          },
        ],
      },
      {
        id: "sec_social",
        key: "social",
        title: "Social",
        builtinKey: "social",
        order: 1,
        repeatable: true,
        records: [
          {
            id: "lnk_site",
            fields: [{ id: "fld_site", key: "rank", label: "Rank", type: "text", order: 0, presentation: "inline", value: "Guardian" }],
          },
        ],
      },
    ];
    const adapted = adaptOneVueProfile(dto, createValidWebsite());
    assert.equal(adapted.contact.social.GitHub.navbar, true);
    assert.equal(adapted.contact.social.GitHub.url, "https://github.com/alexrivera");
    assert.equal(adapted.contact.social.GitHub.customFields?.map((field) => field.text).join(","), "Primary");
    assert.equal(adapted.contact.social["link:lnk_other"].navbar, false);
    assert.equal(adapted.contact.social["link:lnk_other"].customFields?.[0].text, "Other account");
    assert.equal(adapted.contact.social.LeetCode.customFields?.[0].text, "Guardian");
    assert.equal(JSON.stringify(adapted).includes("hidden"), false);
    assert.equal(JSON.stringify(adapted).includes("/api/assets/private/"), false);

    dto.contact.socialLinks[2].platform = "LeetCode profile";
    const renamed = adaptOneVueProfile(dto, createValidWebsite());
    const renamedLink = Object.values(renamed.contact.social).find((item) => item.sourceId === "lnk_site");
    assert.equal(renamedLink?.customFields?.[0].text, "Guardian");
    assert.equal(renamed.contact.social.GitHub.navbar, true);
    assert.equal(Object.values(renamed.contact.social).filter((item) => item.navbar && item.iconName === "github").length, 1);
  });
});
