/**
 * Development & Local Testing Fixtures for Portfolio SSR
 *
 * Strictly isolated for local development verification when upstream backend is offline.
 * Never used in production builds.
 */

import type { OneVuePublicApiResponse } from "./onevue-profile-adapter";

export const LOCAL_TEST_PROFILES: Record<string, OneVuePublicApiResponse> = {
  alexrivera: {
    success: true,
    dto: {
      meta: {
        schemaVersion: "1.0.0",
        username: "alexrivera",
        canonicalUrl: "https://onevue.me/p/alexrivera",
        publishedAt: "2026-10-30T10:00:00.000Z",
        templateId: "community-template",
        templateVersion: "1.1.0",
      },
      profile: {
        displayName: "Alex Rivera",
        preferredName: "Alex",
        initials: "AR",
        headline: "Systems & Cloud Infrastructure Engineer",
        bio: "Specializing in distributed systems, kernel telemetry, and type-safe web architecture. Passionate about open-source developer infrastructure.",
        profilePhoto: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
        location: {
          city: "San Francisco",
          state: "CA",
          country: "USA",
          formatted: "San Francisco, CA, USA",
        },
        careerInterests: ["Distributed Systems", "Cloud Infrastructure"],
        areasOfInterest: ["Rust", "TypeScript", "Linux"],
        languages: [{ language: "English", proficiency: "fluent" }],
      },
      education: [
        {
          id: "edu_1",
          institution: "University of California, Berkeley",
          degree: "B.S. in Computer Science",
          fieldOfStudy: "Computer Science",
          startDate: "2022",
          endDate: "2026",
          currentStatus: "studying",
          gpa: "3.95",
          gpaScale: "4.0",
          location: "Berkeley, CA",
          website: "https://berkeley.edu",
        },
      ],
      projects: [
        {
          id: "proj_1",
          title: "HyperFlow Distributed Engine",
          shortDescription: "Ultra-low latency streaming compute engine for real-time telemetry processing.",
          technologies: ["Rust", "TypeScript", "Docker", "PostgreSQL"],
          liveUrl: "https://hyperflow.dev",
          repoUrl: "https://github.com/onevue/hyperflow",
        },
      ],
      skills: [
        { id: "sk_1", name: "Rust", category: "Programming Languages", proficiency: "Expert" },
        { id: "sk_2", name: "TypeScript", category: "Programming Languages", proficiency: "Advanced" },
        { id: "sk_3", name: "PostgreSQL", category: "Databases", proficiency: "Intermediate" },
      ],
      credentials: [
        {
          id: "cred_1",
          title: "AWS Certified Solutions Architect",
          credentialType: "certification",
          issuer: "Amazon Web Services",
          issueDate: "2024",
          verificationUrl: "https://aws.amazon.com/verify/12345",
        },
      ],
      achievements: [],
      media: [],
      contact: {
        email: "alex.rivera@example.com",
        socialLinks: [
          { id: "sl_1", platform: "GitHub", url: "https://github.com/alexrivera", category: "coding", isPrimary: true },
          { id: "sl_2", platform: "LinkedIn", url: "https://linkedin.com/in/alexrivera", category: "professional", isPrimary: true },
        ],
      },
    },
    website: {
      username: "alexrivera",
      templateId: "community-template",
      templateVersion: "1.1.0",
      publishedAt: "2026-10-30T10:00:00.000Z",
      revisionNumber: 1,
      customization: {
        accentColor: "#10b981",
        themeMode: "dark",
        visibleSections: ["about", "education", "projects", "skills", "credentials", "contact"],
      },
    },
  },
  student: {
    success: true,
    dto: {
      meta: {
        schemaVersion: "1.0.0",
        username: "student",
        canonicalUrl: "https://onevue.me/p/student",
        publishedAt: "2026-10-30T10:00:00.000Z",
        templateId: "magicui-portfolio",
        templateVersion: "1.0.0",
      },
      profile: {
        displayName: "Student Scholar",
        preferredName: "Student",
        initials: "SS",
        headline: "Undergraduate Computer Science Researcher",
        bio: "Undergraduate researcher exploring modern developer tools, distributed web services, and responsive UI design.",
        location: {
          city: "San Francisco",
          state: "CA",
          country: "USA",
          formatted: "San Francisco, CA, USA",
        },
        careerInterests: ["Web Engineering"],
        areasOfInterest: ["React", "Next.js"],
        languages: [{ language: "English", proficiency: "fluent" }],
      },
      education: [
        {
          id: "edu_std_1",
          institution: "Stanford University",
          degree: "B.S. in Computer Science",
          currentStatus: "studying",
        },
      ],
      projects: [],
      skills: [{ id: "sk_std_1", name: "TypeScript", category: "Programming Languages", proficiency: "Advanced" }],
      credentials: [],
      achievements: [],
      media: [],
      contact: {
        socialLinks: [],
      },
    },
    website: {
      username: "student",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      publishedAt: "2026-10-30T10:00:00.000Z",
      revisionNumber: 1,
      customization: {
        accentColor: "#3b82f6",
        themeMode: "system",
        visibleSections: ["about", "education", "skills", "contact"],
      },
    },
  },
};
