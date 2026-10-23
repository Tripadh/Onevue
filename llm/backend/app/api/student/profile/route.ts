import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import * as jwtLib from "jsonwebtoken";
import mongoose from "mongoose";
import connectToDatabase from "../../../../lib/db";
import { ensureStudentProfile } from "../../../../lib/ensure-student-profile";
import User from "../../../../models/User";
import {
  SKILL_CATEGORIES,
  SKILL_PROFICIENCIES,
  IStudentEducation,
  IStudentProject,
  IStudentSkill,
  IStudentCredential,
  IStudentAchievement,
  IStudentMediaItem,
  IStudentPlatformLink,
} from "../../../../models/StudentProfile";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   Authentication & Authorization Helper
   ========================================================================= */

function verifyJwtToken(token: string, secret: string): { id: string; email: string } {
  const pkg: any = jwtLib;
  const verifier =
    (pkg && typeof pkg.verify === "function" && pkg.verify) ||
    (pkg && pkg.default && typeof pkg.default.verify === "function" && pkg.default.verify) ||
    (typeof require === "function" && require("jsonwebtoken").verify);

  if (!verifier) {
    throw new Error("JWT verify function not found.");
  }
  return verifier(token, secret) as { id: string; email: string };
}

function getUserModel() {
  return (User as any).default || User;
}

async function verifyStudentAuth(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: "Authentication required. Please provide a valid Bearer token.",
      status: 401,
    };
  }

  const token = authHeader.split(" ")[1];
  let decoded: { id: string; email: string };
  try {
    decoded = verifyJwtToken(token, process.env.JWT_SECRET || "fallback_secret");
  } catch (err) {
    console.error("verifyJwtToken failed with:", err);
    return { error: "Invalid or expired session token.", status: 401 };
  }

  await connectToDatabase();
  const UserModel = getUserModel();
  const user = await UserModel.findById(decoded.id);
  if (!user) {
    return { error: "Authenticated user no longer exists.", status: 401 };
  }

  return { user };
}

/* =========================================================================
   Validation Helpers
   ========================================================================= */

function normalizeUrl(val: unknown): string {
  if (!val || typeof val !== "string") return "";
  let trimmed = val.trim();
  if (!trimmed || /^(none|n\/a|na|no|nil|null|-|\/)$/i.test(trimmed)) {
    return "";
  }
  // Auto-prefix https:// if user provided a domain or github shorthand without protocol
  if (!/^https?:\/\//i.test(trimmed)) {
    if (trimmed.includes(".") || trimmed.startsWith("localhost")) {
      trimmed = "https://" + trimmed;
    } else if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      trimmed = "https://github.com/" + trimmed;
    }
  }
  return trimmed;
}

function isValidUrl(val: string): boolean {
  if (!val || typeof val !== "string") return true;
  const normalized = normalizeUrl(val);
  if (normalized === "") return true;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const VALID_EDUCATION_STATUSES = new Set(["studying", "completed", "paused", "withdrawn"]);
const VALID_INSTITUTION_TYPES = new Set([
  "school",
  "junior_college",
  "diploma_college",
  "university",
  "training_institution",
  "other",
]);
const VALID_PROJECT_TYPES = new Set([
  "academic",
  "personal",
  "hackathon",
  "internship",
  "research",
  "open_source",
  "freelance",
  "startup",
  "competition",
  "other",
]);
const VALID_PROJECT_STATUSES = new Set([
  "planning",
  "in_progress",
  "completed",
  "paused",
  "archived",
]);
const VALID_CREDENTIAL_TYPES = new Set([
  "certification",
  "course_certificate",
  "professional_certification",
  "workshop",
  "bootcamp",
  "training",
  "license",
  "academic_certificate",
  "micro_credential",
  "badge",
  "other",
]);
const VALID_ACHIEVEMENT_CATEGORIES = new Set([
  "hackathon",
  "competition",
  "academic",
  "research",
  "coding",
  "sports",
  "leadership",
  "volunteering",
  "innovation",
  "entrepreneurship",
  "open_source",
  "publication",
  "award",
  "other",
]);
const VALID_MEDIA_TYPES = new Set([
  "image",
  "video",
  "pdf",
  "presentation",
  "document",
  "external_media",
]);
const VALID_MEDIA_CATEGORIES = new Set([
  "profile",
  "project",
  "research",
  "achievement",
  "other",
]);
const VALID_LINK_CATEGORIES = new Set([
  "coding",
  "professional",
  "social",
  "project",
  "research",
  "other",
]);
const VALID_VISIBILITIES = new Set(["public", "connections", "recruiters", "private"]);

// Category normalization map for skills (supports legacy values)
const SKILL_CATEGORY_MAP: Record<string, string> = {
  technical: "Programming Languages",
  frameworks: "Frontend",
  soft: "Other Skills",
  general: "Tools",
};

/* =========================================================================
   Visibility & Privacy Serialization Helper
   ========================================================================= */

function serializeProfile(profile: any, isOwner: boolean) {
  const obj = profile.toObject ? profile.toObject() : { ...profile };

  // Always delete internal version key
  delete obj.__v;

  // Filter internal storage key from public or non-owner responses
  if (!isOwner && obj.resume) {
    delete obj.resume.storageKey;
  }

  // Filter sensitive fields if not owner
  if (!isOwner) {
    delete obj.dob;
    delete obj.gender;

    // Filter education rollNumber
    if (Array.isArray(obj.education)) {
      obj.education = obj.education.map((e: any) => {
        const copy = { ...e };
        delete copy.rollNumber;
        return copy;
      });
    }

    // Filter private contacts according to visibility settings
    if (obj.contacts) {
      const emailVis = obj.contacts.visibility?.email || "private";
      const phoneVis = obj.contacts.visibility?.phone || "private";
      if (emailVis === "private") {
        obj.contacts.email = "";
      }
      if (phoneVis === "private") {
        obj.contacts.phone = "";
        obj.contacts.countryCode = "";
      }
    }

    // Filter private media
    if (Array.isArray(obj.media)) {
      obj.media = obj.media.filter((m: any) => m.visibility !== "private");
    }

    // Filter private links
    if (Array.isArray(obj.links)) {
      obj.links = obj.links.filter((l: any) => l.visibility !== "private");
    }
  }

  return obj;
}

/* =========================================================================
   GET /api/student/profile
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const authResult = await verifyStudentAuth(req);
    if ("error" in authResult) {
      return json(req, { message: authResult.error }, { status: authResult.status });
    }

    const { user } = authResult;
    // Contact email is deliberately empty to protect user privacy (not prefilled with login email)
    const profile = await ensureStudentProfile(user);

    const serialized = serializeProfile(profile, true);

    return json(req,
      {
        success: true,
        profile: serialized,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}

/* =========================================================================
   PUT /api/student/profile
   ========================================================================= */

export async function PUT(req: Request) {
  try {
    const authResult = await verifyStudentAuth(req);
    if ("error" in authResult) {
      return json(req, { message: authResult.error }, { status: authResult.status });
    }

    const { user } = authResult;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(req,
        { message: "Malformed JSON payload in request body." },
        { status: 400 }
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json(req,
        { message: "Request body must be an object." },
        { status: 400 }
      );
    }

    // Reject or ignore client-supplied ownership or server-managed overrides
    if (body.userId !== undefined && String(body.userId) !== String(user._id)) {
      return json(req,
        { message: "Unauthorized attempt to modify profile ownership." },
        { status: 403 }
      );
    }

    // Reject multiple resumes attempt
    if (body.resumes !== undefined) {
      return json(req,
        {
          message:
            "Multiple resumes are not permitted. Each student has exactly one resume slot.",
        },
        { status: 400 }
      );
    }

    const profile = await ensureStudentProfile(user);

    // -----------------------------------------------------------------------
    // Module 1: Personal Profile Scalars
    // -----------------------------------------------------------------------
    const personalScalars = [
      "preferredName",
      "profilePhoto",
      "headline",
      "bio",
      "dob",
      "gender",
      "nationality",
      "country",
      "state",
      "city",
      "currentStatus",
    ] as const;

    for (const f of personalScalars) {
      if (body[f] !== undefined) {
        if (body[f] !== null && typeof body[f] !== "string") {
          return json(req,
            { message: `Field '${f}' must be a string.` },
            { status: 400 }
          );
        }
        profile[f] = body[f] ? String(body[f]).trim() : "";
      }
    }

    // Gender validation
    if (body.gender !== undefined) {
      const g = String(body.gender || "").trim();
      if (g && !["male", "female", "non-binary", "prefer-not-to-say", "other"].includes(g)) {
        return json(req, { message: `Invalid gender option: '${g}'` }, { status: 400 });
      }
      profile.gender = g;
    }

    // Profile photo URL validation
    if (body.profilePhoto !== undefined && body.profilePhoto !== "") {
      if (!isValidUrl(String(body.profilePhoto))) {
        return json(req,
          { message: "Invalid URL for profile photo." },
          { status: 400 }
        );
      }
    }

    // Career interests & areas of interest
    if (body.careerInterests !== undefined) {
      if (!Array.isArray(body.careerInterests)) {
        return json(req,
          { message: "careerInterests must be an array of strings." },
          { status: 400 }
        );
      }
      profile.careerInterests = body.careerInterests.map((s) => String(s).trim()).filter(Boolean);
    }

    if (body.areasOfInterest !== undefined) {
      if (!Array.isArray(body.areasOfInterest)) {
        return json(req,
          { message: "areasOfInterest must be an array of strings." },
          { status: 400 }
        );
      }
      profile.areasOfInterest = body.areasOfInterest.map((s) => String(s).trim()).filter(Boolean);
    }

    // Languages
    if (body.languages !== undefined) {
      if (!Array.isArray(body.languages)) {
        return json(req,
          { message: "languages must be an array." },
          { status: 400 }
        );
      }
      const validLangs = [];
      for (const item of body.languages) {
        if (typeof item !== "object" || item === null) {
          return json(req,
            { message: "Each language entry must be an object." },
            { status: 400 }
          );
        }
        const langName = String(item.language || "").trim();
        if (!langName) continue;
        const prof = String(item.proficiency || "conversational").trim();
        validLangs.push({
          language: langName,
          proficiency: ["basic", "conversational", "fluent", "native"].includes(prof)
            ? prof
            : "conversational",
        });
      }
      profile.languages = validLangs as any;
    }

    // Legacy academic scalars (supported for backward compatibility, NOT canonical)
    const legacyScalars = ["school", "degree", "gradYear", "gpa"] as const;
    for (const lf of legacyScalars) {
      if (body[lf] !== undefined) {
        profile[lf] = body[lf] ? String(body[lf]).trim() : "";
      }
    }

    // -----------------------------------------------------------------------
    // Module 2: Education (Canonical Source of Truth)
    // -----------------------------------------------------------------------
    if (body.education !== undefined) {
      if (!Array.isArray(body.education)) {
        return json(req,
          { message: "Field 'education' must be an array." },
          { status: 400 }
        );
      }

      const validatedEdu: IStudentEducation[] = [];
      for (let i = 0; i < body.education.length; i++) {
        const item = body.education[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Education item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const institution = String(item.institution || "").trim();
        const degree = String(item.degree || "").trim();

        if (!institution) {
          return json(req,
            { message: `Education item at index ${i} requires 'institution'.` },
            { status: 400 }
          );
        }
        if (!degree) {
          return json(req,
            { message: `Education item at index ${i} requires 'degree'.` },
            { status: 400 }
          );
        }

        const status = String(item.currentStatus || "studying").trim();
        if (status && !VALID_EDUCATION_STATUSES.has(status)) {
          return json(req,
            { message: `Invalid education currentStatus: '${status}'` },
            { status: 400 }
          );
        }

        const instType = String(item.institutionType || "university").trim();
        if (instType && !VALID_INSTITUTION_TYPES.has(instType)) {
          return json(req,
            { message: `Invalid education institutionType: '${instType}'` },
            { status: 400 }
          );
        }

        if (item.website && !isValidUrl(String(item.website))) {
          return json(req,
            { message: `Invalid website URL in education item '${institution}'.` },
            { status: 400 }
          );
        }

        // Find existing record to preserve server-managed verificationStatus
        let existingVerification = "self-reported";
        if (item._id || item.id) {
          const match = profile.education.find(
            (e: any) =>
              (e._id && String(e._id) === String(item._id || item.id)) ||
              (e.id && e.id === String(item.id || item._id))
          );
          if (match && match.verificationStatus) {
            existingVerification = match.verificationStatus;
          }
        }

        validatedEdu.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          institution,
          institutionType: (instType as any) || "university",
          degree,
          fieldOfStudy: String(item.fieldOfStudy || "").trim(),
          specialization: String(item.specialization || "").trim(),
          department: String(item.department || "").trim(),
          startDate: String(item.startDate || item.startYear || "").trim(),
          endDate: String(item.endDate || item.gradYear || "").trim(),
          expectedGradDate: String(item.expectedGradDate || "").trim(),
          currentStatus: (status as any) || "studying",
          gpa: String(item.gpa || "").trim(),
          gpaScale: String(item.gpaScale || "4.0").trim(),
          percentage: String(item.percentage || "").trim(),
          gradeClass: String(item.gradeClass || "").trim(),
          rank: String(item.rank || "").trim(),
          location: String(item.location || "").trim(),
          website: String(item.website || "").trim(),
          rollNumber: String(item.rollNumber || "").trim(),
          accreditation: String(item.accreditation || "").trim(),
          coursework: String(item.coursework || "").trim(),
          honors: String(item.honors || "").trim(),
          startYear: String(item.startYear || item.startDate || "").trim(),
          gradYear: String(item.gradYear || item.endDate || "").trim(),
          verificationStatus: existingVerification as any,
        });
      }

      profile.education = validatedEdu as any;
    }

    // -----------------------------------------------------------------------
    // Module 3: Projects
    // -----------------------------------------------------------------------
    if (body.projects !== undefined) {
      if (!Array.isArray(body.projects)) {
        return json(req,
          { message: "Field 'projects' must be an array." },
          { status: 400 }
        );
      }

      const validatedProjects: IStudentProject[] = [];
      for (let i = 0; i < body.projects.length; i++) {
        const item = body.projects[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Project item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const title = String(item.title || "").trim();
        if (!title) {
          return json(req,
            { message: `Project item at index ${i} requires 'title'.` },
            { status: 400 }
          );
        }

        const pType = String(item.projectType || "academic").trim();
        if (pType && !VALID_PROJECT_TYPES.has(pType)) {
          return json(req,
            { message: `Invalid projectType: '${pType}'` },
            { status: 400 }
          );
        }

        const status = String(item.status || "completed").trim();
        if (status && !VALID_PROJECT_STATUSES.has(status)) {
          return json(req,
            { message: `Invalid project status: '${status}'` },
            { status: 400 }
          );
        }

        const repoUrl = normalizeUrl(item.repoUrl);
        const liveUrl = normalizeUrl(item.liveUrl);
        const docsUrl = normalizeUrl(item.docsUrl);
        const videoUrl = normalizeUrl(item.videoUrl);
        const websiteUrl = normalizeUrl(item.websiteUrl);
        const link = normalizeUrl(item.link || item.liveUrl || item.repoUrl);

        const urls = [
          { name: "repoUrl", val: repoUrl, original: item.repoUrl },
          { name: "liveUrl", val: liveUrl, original: item.liveUrl },
          { name: "docsUrl", val: docsUrl, original: item.docsUrl },
          { name: "videoUrl", val: videoUrl, original: item.videoUrl },
          { name: "websiteUrl", val: websiteUrl, original: item.websiteUrl },
          { name: "link", val: link, original: item.link },
        ];
        for (const u of urls) {
          if (u.original && !isValidUrl(String(u.original))) {
            return json(req,
              {
                message: `Invalid ${u.name} URL in project '${title}'. Please provide a valid web link starting with https:// (e.g. https://github.com/...) or leave it blank if not hosted online.`,
              },
              { status: 400 }
            );
          }
        }

        validatedProjects.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          title,
          shortDescription: String(item.shortDescription || item.summary || "").trim(),
          detailedDescription: String(item.detailedDescription || "").trim(),
          projectType: (pType as any) || "academic",
          role: String(item.role || "").trim(),
          status: (status as any) || "completed",
          isTeam: Boolean(item.isTeam),
          teamSize: Number(item.teamSize) || 1,
          teamMembers: Array.isArray(item.teamMembers) ? item.teamMembers : [],
          startDate: String(item.startDate || "").trim(),
          endDate: String(item.endDate || "").trim(),
          technologies: Array.isArray(item.technologies)
            ? item.technologies.map(String)
            : item.techStack
            ? String(item.techStack).split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          techStack: String(item.techStack || "").trim(),
          repoUrl,
          liveUrl,
          docsUrl,
          videoUrl,
          websiteUrl,
          problemSolved: String(item.problemSolved || "").trim(),
          keyFeatures: String(item.keyFeatures || "").trim(),
          challengesSolutions: String(item.challengesSolutions || "").trim(),
          metricsResults: String(item.metricsResults || "").trim(),
          impact: String(item.impact || "").trim(),
          aiDetails: item.aiDetails ? {
            dataset: String(item.aiDetails.dataset || "").trim(),
            algorithms: String(item.aiDetails.algorithms || "").trim(),
            modelName: String(item.aiDetails.modelName || "").trim(),
            metrics: String(item.aiDetails.metrics || "").trim(),
          } : undefined,
          summary: String(item.summary || item.shortDescription || "").trim(),
          link: link || liveUrl || repoUrl,
        });
      }

      profile.projects = validatedProjects as any;
    }

    // -----------------------------------------------------------------------
    // Module 4: Skills
    // -----------------------------------------------------------------------
    if (body.skills !== undefined) {
      if (!Array.isArray(body.skills)) {
        return json(req,
          { message: "Field 'skills' must be an array." },
          { status: 400 }
        );
      }

      const validatedSkills: IStudentSkill[] = [];
      for (let i = 0; i < body.skills.length; i++) {
        const item = body.skills[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Skill item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const name = String(item.name || "").trim();
        if (!name) {
          return json(req,
            { message: `Skill item at index ${i} requires 'name'.` },
            { status: 400 }
          );
        }

        let cat = String(item.category || "Programming Languages").trim();
        if (SKILL_CATEGORY_MAP[cat]) {
          cat = SKILL_CATEGORY_MAP[cat];
        }
        if (!SKILL_CATEGORIES.includes(cat as any)) {
          cat = "Other Skills";
        }

        let prof = String(item.proficiency || item.level || "Intermediate").trim();
        if (!SKILL_PROFICIENCIES.includes(prof as any)) {
          prof = "Intermediate";
        }

        validatedSkills.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          name,
          category: cat as any,
          proficiency: prof as any,
          yearsExperience: Number(item.yearsExperience) || 0,
          lastUsed: String(item.lastUsed || "").trim(),
          evidence: String(item.evidence || "").trim(),
          relatedProjects: Array.isArray(item.relatedProjects) ? item.relatedProjects : [],
          relatedCredentials: Array.isArray(item.relatedCredentials) ? item.relatedCredentials : [],
          level: prof,
        });
      }

      profile.skills = validatedSkills as any;
    }

    // -----------------------------------------------------------------------
    // Module 5: Credentials
    // -----------------------------------------------------------------------
    if (body.credentials !== undefined) {
      if (!Array.isArray(body.credentials)) {
        return json(req,
          { message: "Field 'credentials' must be an array." },
          { status: 400 }
        );
      }

      const validatedCreds: IStudentCredential[] = [];
      for (let i = 0; i < body.credentials.length; i++) {
        const item = body.credentials[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Credential item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const title = String(item.title || "").trim();
        const issuer = String(item.issuer || "").trim();
        if (!title || !issuer) {
          return json(req,
            { message: `Credential at index ${i} requires 'title' and 'issuer'.` },
            { status: 400 }
          );
        }

        const credType = String(item.credentialType || "course_certificate").trim();
        if (credType && !VALID_CREDENTIAL_TYPES.has(credType)) {
          return json(req,
            { message: `Invalid credentialType: '${credType}'` },
            { status: 400 }
          );
        }

        if (item.credentialUrl && !isValidUrl(String(item.credentialUrl))) {
          return json(req,
            { message: `Invalid credentialUrl in '${title}'.` },
            { status: 400 }
          );
        }
        if (item.verificationUrl && !isValidUrl(String(item.verificationUrl))) {
          return json(req,
            { message: `Invalid verificationUrl in '${title}'.` },
            { status: 400 }
          );
        }

        // Prevent client spoofing of verificationStatus. A changed URL
        // drops a previous issuer decision until certificate verification
        // records a new one.
        let existingVerification = "self-reported";
        let existingMethod = "self-reported";
        let existingCertificateId = "";
        const nextUrl = String(item.verificationUrl || "").trim();
        if (item._id || item.id) {
          const match = profile.credentials.find(
            (c: any) =>
              (c._id && String(c._id) === String(item._id || item.id)) ||
              (c.id && c.id === String(item.id || item._id))
          );
          if (match && String(match.verificationUrl || "").trim() === nextUrl) {
            if (match.verificationStatus) existingVerification = match.verificationStatus;
            if (match.verificationMethod) existingMethod = match.verificationMethod;
            existingCertificateId = String(match.certificateVerificationId || "");
          }
        }

        validatedCreds.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          title,
          credentialType: (credType as any) || "course_certificate",
          issuer,
          credentialId: String(item.credentialId || "").trim(),
          issueDate: String(item.issueDate || "").trim(),
          expirationDate: String(item.expirationDate || "").trim(),
          neverExpires: Boolean(item.neverExpires),
          credentialUrl: String(item.credentialUrl || "").trim(),
          verificationUrl: nextUrl,
          certificateFile: String(item.certificateFile || "").trim(),
          description: String(item.description || "").trim(),
          relatedSkills: Array.isArray(item.relatedSkills) ? item.relatedSkills : [],
          relatedCourse: String(item.relatedCourse || "").trim(),
          credentialStatus: (item.credentialStatus as any) || "active",
          verificationStatus: existingVerification as any,
          verificationMethod: existingMethod,
          certificateVerificationId: existingCertificateId,
        });
      }

      profile.credentials = validatedCreds as any;
    }

    // -----------------------------------------------------------------------
    // Module 6: Achievements
    // -----------------------------------------------------------------------
    if (body.achievements !== undefined) {
      if (!Array.isArray(body.achievements)) {
        return json(req,
          { message: "Field 'achievements' must be an array." },
          { status: 400 }
        );
      }

      const validatedAchievements: IStudentAchievement[] = [];
      for (let i = 0; i < body.achievements.length; i++) {
        const item = body.achievements[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Achievement item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const title = String(item.title || "").trim();
        if (!title) {
          return json(req,
            { message: `Achievement at index ${i} requires 'title'.` },
            { status: 400 }
          );
        }

        const cat = String(item.category || "academic").trim();
        if (cat && !VALID_ACHIEVEMENT_CATEGORIES.has(cat)) {
          return json(req,
            { message: `Invalid achievement category: '${cat}'` },
            { status: 400 }
          );
        }

        if (item.proofUrl && !isValidUrl(String(item.proofUrl))) {
          return json(req,
            { message: `Invalid proofUrl in achievement '${title}'.` },
            { status: 400 }
          );
        }

        // Prevent client spoofing of verificationStatus
        let existingVerification = "self-reported";
        if (item._id || item.id) {
          const match = profile.achievements.find(
            (a: any) =>
              (a._id && String(a._id) === String(item._id || item.id)) ||
              (a.id && a.id === String(item.id || item._id))
          );
          if (match && match.verificationStatus) {
            existingVerification = match.verificationStatus;
          }
        }

        validatedAchievements.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          title,
          category: (cat as any) || "academic",
          organization: String(item.organization || "").trim(),
          date: String(item.date || item.year || "").trim(),
          year: String(item.year || item.date || "").trim(),
          description: String(item.description || "").trim(),
          positionRank: String(item.positionRank || "").trim(),
          awardPrize: String(item.awardPrize || "").trim(),
          teamSize: Number(item.teamSize) || 1,
          role: String(item.role || "").trim(),
          location: String(item.location || "").trim(),
          proofUrl: String(item.proofUrl || "").trim(),
          certificateUrl: String(item.certificateUrl || "").trim(),
          evidenceStorageKey: String(item.evidenceStorageKey || "").trim(),
          relatedProject: String(item.relatedProject || "").trim(),
          skillsDemonstrated: Array.isArray(item.skillsDemonstrated) ? item.skillsDemonstrated : [],
          verificationStatus: existingVerification as any,
        });
      }

      profile.achievements = validatedAchievements as any;
    }

    // -----------------------------------------------------------------------
    // Module 7: Resume (Exactly ONE slot)
    // -----------------------------------------------------------------------
    if (body.resume !== undefined) {
      if (typeof body.resume !== "object" || body.resume === null || Array.isArray(body.resume)) {
        return json(req,
          { message: "Field 'resume' must be an object (single resume metadata)." },
          { status: 400 }
        );
      }

      const r = body.resume as Record<string, unknown>;
      if (!profile.resume) {
        profile.resume = {
          storageKey: "",
          fileName: "",
          fileSize: 0,
          contentType: "application/pdf",
          uploadedAt: null,
          resumeName: "Primary Resume",
          targetRole: "",
        };
      }

      if (r.fileName !== undefined) {
        const fn = String(r.fileName || "").trim();
        profile.resume.fileName = fn;
        profile.resumeFileName = fn;
      }
      if (r.storageKey !== undefined) {
        profile.resume.storageKey = String(r.storageKey || "").trim();
      }
      if (r.contentType !== undefined) {
        const ct = String(r.contentType || "application/pdf").trim();
        if (ct && ct !== "application/pdf") {
          return json(req,
            { message: "Only PDF resumes are supported ('application/pdf')." },
            { status: 400 }
          );
        }
        profile.resume.contentType = ct;
      }
      if (r.fileSize !== undefined) {
        const size = Number(r.fileSize);
        if (isNaN(size) || size < 0 || size > 10 * 1024 * 1024) {
          return json(req,
            { message: "Resume fileSize must be between 0 and 10MB." },
            { status: 400 }
          );
        }
        profile.resume.fileSize = size;
      }
      if (r.resumeName !== undefined) {
        profile.resume.resumeName = String(r.resumeName || "Primary Resume").trim();
      }
      if (r.targetRole !== undefined) {
        profile.resume.targetRole = String(r.targetRole || "").trim();
      }
      if (r.uploadedAt !== undefined) {
        const d = r.uploadedAt ? new Date(r.uploadedAt as string) : null;
        profile.resume.uploadedAt = d;
        profile.resumeLastUpdated = d;
      }
    }

    if (body.resumeUrl !== undefined) {
      if (body.resumeUrl && !isValidUrl(String(body.resumeUrl))) {
        return json(req,
          { message: "Invalid resumeUrl." },
          { status: 400 }
        );
      }
      profile.resumeUrl = String(body.resumeUrl || "").trim();
    }
    if (body.resumeFileName !== undefined) {
      profile.resumeFileName = String(body.resumeFileName || "").trim();
    }

    // -----------------------------------------------------------------------
    // Module 8: Media Gallery
    // -----------------------------------------------------------------------
    if (body.media !== undefined) {
      if (!Array.isArray(body.media)) {
        return json(req,
          { message: "Field 'media' must be an array." },
          { status: 400 }
        );
      }

      const validatedMedia: IStudentMediaItem[] = [];
      for (let i = 0; i < body.media.length; i++) {
        const item = body.media[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Media item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const mediaUrl = String(item.mediaUrl || item.url || "").trim();
        const title = String(item.title || "").trim();
        if (!mediaUrl || !title) {
          return json(req,
            { message: `Media item at index ${i} requires 'mediaUrl' and 'title'.` },
            { status: 400 }
          );
        }

        if (!isValidUrl(mediaUrl)) {
          return json(req,
            { message: `Invalid mediaUrl in '${title}'.` },
            { status: 400 }
          );
        }

        const mType = String(item.mediaType || "image").trim();
        if (mType && !VALID_MEDIA_TYPES.has(mType)) {
          return json(req,
            { message: `Invalid mediaType: '${mType}'` },
            { status: 400 }
          );
        }

        const cat = String(item.category || "project").trim();
        if (cat && !VALID_MEDIA_CATEGORIES.has(cat)) {
          return json(req,
            { message: `Invalid media category: '${cat}'` },
            { status: 400 }
          );
        }

        validatedMedia.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          mediaUrl,
          mediaType: (mType as any) || "image",
          title,
          description: String(item.description || "").trim(),
          category: (cat as any) || "project",
          relatedProject: String(item.relatedProject || "").trim(),
          relatedAchievement: String(item.relatedAchievement || "").trim(),
          displayOrder: Number(item.displayOrder) || 0,
          visibility: (item.visibility as any) || "public",
          isFeatured: Boolean(item.isFeatured),
          altText: String(item.altText || "").trim(),
          fileName: String(item.fileName || "").trim(),
          mimeType: String(item.mimeType || "").trim(),
          fileSize: Number(item.fileSize) || 0,
          uploadedAt: item.uploadedAt ? new Date(item.uploadedAt) : new Date(),
        });
      }

      profile.media = validatedMedia as any;
      // Synchronize mediaUrls for backward compatibility
      profile.mediaUrls = validatedMedia.map((m) => m.mediaUrl);
    }

    if (body.mediaUrls !== undefined && body.media === undefined) {
      if (!Array.isArray(body.mediaUrls)) {
        return json(req,
          { message: "mediaUrls must be an array of strings." },
          { status: 400 }
        );
      }
      profile.mediaUrls = body.mediaUrls.map((u) => String(u).trim()).filter(Boolean);
    }

    // -----------------------------------------------------------------------
    // Module 9: Links & Contacts
    // -----------------------------------------------------------------------
    if (body.links !== undefined) {
      if (!Array.isArray(body.links)) {
        return json(req,
          { message: "Field 'links' must be an array." },
          { status: 400 }
        );
      }

      const validatedLinks: IStudentPlatformLink[] = [];
      for (let i = 0; i < body.links.length; i++) {
        const item = body.links[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          return json(req,
            { message: `Link item at index ${i} must be an object.` },
            { status: 400 }
          );
        }

        const platform = String(item.platform || item.label || "").trim();
        const url = String(item.url || "").trim();
        if (!platform || !url) {
          return json(req,
            { message: `Link item at index ${i} requires 'platform' and 'url'.` },
            { status: 400 }
          );
        }

        if (!isValidUrl(url)) {
          return json(req,
            { message: `Invalid URL '${url}' for platform '${platform}'.` },
            { status: 400 }
          );
        }

        const cat = String(item.category || "professional").trim();
        if (cat && !VALID_LINK_CATEGORIES.has(cat)) {
          return json(req,
            { message: `Invalid link category: '${cat}'` },
            { status: 400 }
          );
        }

        const vis = String(item.visibility || "public").trim();
        if (vis && !VALID_VISIBILITIES.has(vis)) {
          return json(req,
            { message: `Invalid link visibility: '${vis}'` },
            { status: 400 }
          );
        }

        validatedLinks.push({
          ...(item._id ? { _id: item._id } : {}),
          id: item.id ? String(item.id) : undefined,
          platform,
          url,
          category: (cat as any) || "professional",
          username: String(item.username || "").trim(),
          isPrimary: Boolean(item.isPrimary),
          visibility: (vis as any) || "public",
          verificationStatus: "unverified",
        });
      }

      profile.links = validatedLinks as any;
    }

    // Contacts safe nested merge
    if (body.contacts !== undefined) {
      if (typeof body.contacts !== "object" || body.contacts === null || Array.isArray(body.contacts)) {
        return json(req,
          { message: "Field 'contacts' must be an object." },
          { status: 400 }
        );
      }
      const c = body.contacts as Record<string, unknown>;
      if (!profile.contacts) {
        profile.contacts = {
          email: "",
          phone: "",
          countryCode: "",
          city: "",
          state: "",
          country: "",
          visibility: { email: "private", phone: "private" },
          github: "",
          linkedin: "",
          twitter: "",
          portfolio: "",
        };
      }

      if (c.email !== undefined) profile.contacts.email = String(c.email || "").trim();
      if (c.phone !== undefined) profile.contacts.phone = String(c.phone || "").trim();
      if (c.countryCode !== undefined) profile.contacts.countryCode = String(c.countryCode || "").trim();
      if (c.city !== undefined) profile.contacts.city = String(c.city || "").trim();
      if (c.state !== undefined) profile.contacts.state = String(c.state || "").trim();
      if (c.country !== undefined) profile.contacts.country = String(c.country || "").trim();

      // Visibility controls
      if (c.visibility !== undefined && typeof c.visibility === "object" && c.visibility !== null) {
        const vis = c.visibility as Record<string, unknown>;
        if (!profile.contacts.visibility) {
          profile.contacts.visibility = { email: "private", phone: "private" };
        }
        if (vis.email !== undefined && ["private", "recruiters", "public"].includes(String(vis.email))) {
          profile.contacts.visibility.email = vis.email as any;
        }
        if (vis.phone !== undefined && ["private", "recruiters", "public"].includes(String(vis.phone))) {
          profile.contacts.visibility.phone = vis.phone as any;
        }
      }

      // Legacy fields
      if (c.github !== undefined) profile.contacts.github = String(c.github || "").trim();
      if (c.linkedin !== undefined) profile.contacts.linkedin = String(c.linkedin || "").trim();
      if (c.twitter !== undefined) profile.contacts.twitter = String(c.twitter || "").trim();
      if (c.portfolio !== undefined) profile.contacts.portfolio = String(c.portfolio || "").trim();
    }

    // Save with Mongoose validation enabled
    await profile.save();

    const serialized = serializeProfile(profile, true);

    return json(req,
      {
        success: true,
        message: "Student profile saved to MongoDB successfully.",
        profile: serialized,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof mongoose.Error.ValidationError) {
      return json(req,
        { message: "Validation error: " + error.message, details: error.errors },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
