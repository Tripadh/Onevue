import { Schema, model, models } from "mongoose";

/* =========================================================================
   Student Identity — TypeScript Interfaces
   ========================================================================= */

export type EducationStatus = "studying" | "completed" | "paused" | "withdrawn";
export type InstitutionType =
  | "school"
  | "junior_college"
  | "diploma_college"
  | "university"
  | "training_institution"
  | "other";

export interface IStudentEducation {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  institution: string;
  institutionType?: InstitutionType;
  degree: string;
  fieldOfStudy?: string;
  specialization?: string;
  department?: string;
  startDate?: string;
  endDate?: string;
  expectedGradDate?: string;
  currentStatus: EducationStatus;
  gpa?: string;
  gpaScale?: string;
  percentage?: string;
  gradeClass?: string;
  rank?: string;
  location?: string;
  website?: string;
  rollNumber?: string;
  accreditation?: string;
  coursework?: string;
  honors?: string;
  startYear?: string;
  gradYear?: string;
  verificationStatus?: "pending" | "verified" | "rejected" | "self-reported";
}

export type ProjectType =
  | "academic"
  | "personal"
  | "hackathon"
  | "internship"
  | "research"
  | "open_source"
  | "freelance"
  | "startup"
  | "competition"
  | "other";

export type ProjectStatus =
  | "planning"
  | "in_progress"
  | "completed"
  | "paused"
  | "archived";

export interface IStudentProject {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  title: string;
  shortDescription?: string;
  detailedDescription?: string;
  projectType?: ProjectType;
  role?: string;
  status?: ProjectStatus;
  isTeam?: boolean;
  teamSize?: number;
  teamMembers?: string[];
  startDate?: string;
  endDate?: string;
  technologies?: string[];
  techStack?: string;
  repoUrl?: string;
  liveUrl?: string;
  docsUrl?: string;
  videoUrl?: string;
  websiteUrl?: string;
  problemSolved?: string;
  keyFeatures?: string;
  challengesSolutions?: string;
  metricsResults?: string;
  impact?: string;
  aiDetails?: {
    dataset?: string;
    algorithms?: string;
    modelName?: string;
    metrics?: string;
  };
  summary?: string;
  link?: string;
}

export const SKILL_CATEGORIES = [
  "Programming Languages",
  "Frontend",
  "Backend",
  "Databases",
  "AI / ML",
  "Cloud / DevOps",
  "Tools",
  "Other Skills",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_PROFICIENCIES = [
  "Familiar",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Expert",
] as const;
export type SkillProficiency = (typeof SKILL_PROFICIENCIES)[number];

export interface IStudentSkill {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  name: string;
  category: SkillCategory;
  proficiency: SkillProficiency;
  yearsExperience?: number;
  lastUsed?: string;
  evidence?: string;
  relatedProjects?: string[];
  relatedCredentials?: string[];
  level?: string;
}

export type CredentialType =
  | "certification"
  | "course_certificate"
  | "professional_certification"
  | "workshop"
  | "bootcamp"
  | "training"
  | "license"
  | "academic_certificate"
  | "micro_credential"
  | "badge"
  | "other";

export interface IStudentCredential {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  title: string;
  credentialType: CredentialType;
  issuer: string;
  credentialId?: string;
  issueDate?: string;
  expirationDate?: string;
  neverExpires?: boolean;
  credentialUrl?: string;
  verificationUrl?: string;
  certificateFile?: string;
  description?: string;
  relatedSkills?: string[];
  relatedCourse?: string;
  credentialStatus?: "active" | "expired" | "revoked" | "pending_review";
  verificationStatus?: "pending" | "verified" | "rejected" | "self-reported";
  verificationMethod?: string;
  certificateVerificationId?: string;
}

export type AchievementCategory =
  | "hackathon"
  | "competition"
  | "academic"
  | "research"
  | "coding"
  | "sports"
  | "leadership"
  | "volunteering"
  | "innovation"
  | "entrepreneurship"
  | "open_source"
  | "publication"
  | "award"
  | "other";

export interface IStudentAchievement {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  title: string;
  category: AchievementCategory;
  organization?: string;
  date?: string;
  year?: string;
  description?: string;
  positionRank?: string;
  awardPrize?: string;
  teamSize?: number;
  role?: string;
  location?: string;
  proofUrl?: string;
  certificateUrl?: string;
  evidenceStorageKey?: string;
  relatedProject?: string;
  skillsDemonstrated?: string[];
  verificationStatus?: "pending" | "verified" | "rejected" | "self-reported";
}

export interface IStudentResumeMetadata {
  storageKey?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  uploadedAt?: Date | null;
  resumeName?: string;
  targetRole?: string;
}

export type MediaType =
  | "image"
  | "video"
  | "pdf"
  | "presentation"
  | "document"
  | "external_media";

export type MediaCategory =
  | "profile"
  | "project"
  | "research"
  | "achievement"
  | "other";

export interface IStudentMediaItem {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  mediaUrl: string;
  mediaType: MediaType;
  title: string;
  description?: string;
  category: MediaCategory;
  relatedProject?: string;
  relatedAchievement?: string;
  displayOrder?: number;
  visibility?: "public" | "private" | "restricted";
  isFeatured?: boolean;
  altText?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  uploadedAt?: Date;
}

export type LinkCategory =
  | "coding"
  | "professional"
  | "social"
  | "project"
  | "research"
  | "other";

export interface IStudentPlatformLink {
  _id?: Schema.Types.ObjectId | string;
  id?: string;
  platform: string;
  url: string;
  category: LinkCategory;
  username?: string;
  isPrimary?: boolean;
  visibility?: "public" | "connections" | "recruiters" | "private";
  verificationStatus?: "unverified" | "verified" | "failed" | "pending";
}

export interface IStudentContacts {
  email?: string;
  phone?: string;
  countryCode?: string;
  city?: string;
  state?: string;
  country?: string;
  visibility?: {
    email?: "private" | "recruiters" | "public";
    phone?: "private" | "recruiters" | "public";
  };
  github?: string;
  linkedin?: string;
  twitter?: string;
  portfolio?: string;
}

export interface ILanguageProficiency {
  language: string;
  proficiency: "basic" | "conversational" | "fluent" | "native";
}

export interface IStudentProfile {
  userId: Schema.Types.ObjectId;
  // Module 1: Personal Profile
  preferredName?: string;
  profilePhoto?: string;
  headline?: string;
  bio?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  country?: string;
  state?: string;
  city?: string;
  currentStatus?: string;
  careerInterests?: string[];
  areasOfInterest?: string[];
  languages?: ILanguageProficiency[];

  // Legacy academic root fields (preserved for existing readers, NOT canonical)
  school?: string;
  degree?: string;
  gradYear?: string;
  gpa?: string;

  // Module 2-9 Canonical collections
  education: IStudentEducation[];
  projects: IStudentProject[];
  skills: IStudentSkill[];
  credentials: IStudentCredential[];
  achievements: IStudentAchievement[];
  media: IStudentMediaItem[];
  links: IStudentPlatformLink[];

  // Module 7: Resume (Exactly ONE slot)
  resume?: IStudentResumeMetadata;
  resumeUrl?: string;
  resumeFileName?: string;
  resumeLastUpdated?: Date | null;

  // Legacy media strings
  mediaUrls?: string[];

  // Module 9: Contacts
  contacts: IStudentContacts;

  createdAt?: Date;
  updatedAt?: Date;

  // Virtuals
  primaryEducation?: IStudentEducation | null;
}

/* =========================================================================
   Subdocument Schemas
   ========================================================================= */

const EducationSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    institution: {
      type: String,
      required: [true, "Institution is required"],
      trim: true,
      maxlength: 150,
    },
    institutionType: {
      type: String,
      enum: [
        "school",
        "junior_college",
        "diploma_college",
        "university",
        "training_institution",
        "other",
      ],
      default: "university",
    },
    degree: {
      type: String,
      required: [true, "Degree is required"],
      trim: true,
      maxlength: 150,
    },
    fieldOfStudy: { type: String, default: "", trim: true, maxlength: 150 },
    specialization: { type: String, default: "", trim: true, maxlength: 150 },
    department: { type: String, default: "", trim: true, maxlength: 150 },
    startDate: { type: String, default: "", trim: true, maxlength: 50 },
    endDate: { type: String, default: "", trim: true, maxlength: 50 },
    expectedGradDate: { type: String, default: "", trim: true, maxlength: 50 },
    currentStatus: {
      type: String,
      enum: ["studying", "completed", "paused", "withdrawn"],
      default: "studying",
    },
    gpa: { type: String, default: "", trim: true, maxlength: 50 },
    gpaScale: { type: String, default: "4.0", trim: true, maxlength: 20 },
    percentage: { type: String, default: "", trim: true, maxlength: 20 },
    gradeClass: { type: String, default: "", trim: true, maxlength: 50 },
    rank: { type: String, default: "", trim: true, maxlength: 50 },
    location: { type: String, default: "", trim: true, maxlength: 150 },
    website: { type: String, default: "", trim: true, maxlength: 300 },
    rollNumber: { type: String, default: "", trim: true, maxlength: 100 },
    accreditation: { type: String, default: "", trim: true, maxlength: 150 },
    coursework: { type: String, default: "", trim: true, maxlength: 2000 },
    honors: { type: String, default: "", trim: true, maxlength: 1000 },
    startYear: { type: String, default: "", trim: true, maxlength: 20 },
    gradYear: { type: String, default: "", trim: true, maxlength: 20 },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "self-reported"],
      default: "self-reported",
    },
  },
  { _id: true }
);

const ProjectSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    title: {
      type: String,
      required: [true, "Project title is required"],
      trim: true,
      maxlength: 150,
    },
    shortDescription: { type: String, default: "", trim: true, maxlength: 500 },
    detailedDescription: { type: String, default: "", trim: true, maxlength: 3000 },
    projectType: {
      type: String,
      enum: [
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
      ],
      default: "academic",
    },
    role: { type: String, default: "", trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ["planning", "in_progress", "completed", "paused", "archived"],
      default: "completed",
    },
    isTeam: { type: Boolean, default: false },
    teamSize: { type: Number, default: 1, min: 1, max: 200 },
    teamMembers: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    startDate: { type: String, default: "", trim: true, maxlength: 50 },
    endDate: { type: String, default: "", trim: true, maxlength: 50 },
    technologies: {
      type: [{ type: String, trim: true, maxlength: 60 }],
      default: [],
    },
    techStack: { type: String, default: "", trim: true, maxlength: 300 },
    repoUrl: { type: String, default: "", trim: true, maxlength: 500 },
    liveUrl: { type: String, default: "", trim: true, maxlength: 500 },
    docsUrl: { type: String, default: "", trim: true, maxlength: 500 },
    videoUrl: { type: String, default: "", trim: true, maxlength: 500 },
    websiteUrl: { type: String, default: "", trim: true, maxlength: 500 },
    problemSolved: { type: String, default: "", trim: true, maxlength: 1500 },
    keyFeatures: { type: String, default: "", trim: true, maxlength: 1500 },
    challengesSolutions: { type: String, default: "", trim: true, maxlength: 1500 },
    metricsResults: { type: String, default: "", trim: true, maxlength: 1000 },
    impact: { type: String, default: "", trim: true, maxlength: 1000 },
    aiDetails: {
      dataset: { type: String, default: "", trim: true, maxlength: 200 },
      algorithms: { type: String, default: "", trim: true, maxlength: 300 },
      modelName: { type: String, default: "", trim: true, maxlength: 150 },
      metrics: { type: String, default: "", trim: true, maxlength: 300 },
    },
    summary: { type: String, default: "", trim: true, maxlength: 1000 },
    link: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: true }
);

const SkillSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    name: {
      type: String,
      required: [true, "Skill name is required"],
      trim: true,
      maxlength: 100,
    },
    category: {
      type: String,
      enum: [
        "Programming Languages",
        "Frontend",
        "Backend",
        "Databases",
        "AI / ML",
        "Cloud / DevOps",
        "Tools",
        "Other Skills",
        // legacy values supported for graceful migration
        "technical",
        "frameworks",
        "soft",
        "general",
      ],
      default: "Programming Languages",
    },
    proficiency: {
      type: String,
      enum: ["Familiar", "Beginner", "Intermediate", "Advanced", "Expert"],
      default: "Intermediate",
    },
    yearsExperience: { type: Number, default: 0, min: 0, max: 60 },
    lastUsed: { type: String, default: "", trim: true, maxlength: 30 },
    evidence: { type: String, default: "", trim: true, maxlength: 500 },
    relatedProjects: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    relatedCredentials: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    level: { type: String, default: "Intermediate", trim: true, maxlength: 50 },
  },
  { _id: true }
);

const CredentialSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    title: {
      type: String,
      required: [true, "Credential title is required"],
      trim: true,
      maxlength: 150,
    },
    credentialType: {
      type: String,
      enum: [
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
      ],
      default: "course_certificate",
    },
    issuer: {
      type: String,
      required: [true, "Issuer is required"],
      trim: true,
      maxlength: 150,
    },
    credentialId: { type: String, default: "", trim: true, maxlength: 100 },
    issueDate: { type: String, default: "", trim: true, maxlength: 50 },
    expirationDate: { type: String, default: "", trim: true, maxlength: 50 },
    neverExpires: { type: Boolean, default: false },
    credentialUrl: { type: String, default: "", trim: true, maxlength: 500 },
    verificationUrl: { type: String, default: "", trim: true, maxlength: 500 },
    certificateFile: { type: String, default: "", trim: true, maxlength: 500 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    relatedSkills: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    relatedCourse: { type: String, default: "", trim: true, maxlength: 150 },
    credentialStatus: {
      type: String,
      enum: ["active", "expired", "revoked", "pending_review"],
      default: "active",
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "self-reported"],
      default: "self-reported",
    },
    verificationMethod: { type: String, default: "self-reported", trim: true, maxlength: 100 },
    certificateVerificationId: { type: String, default: "", trim: true, maxlength: 64 },
  },
  { _id: true }
);

const AchievementSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    title: {
      type: String,
      required: [true, "Achievement title is required"],
      trim: true,
      maxlength: 150,
    },
    category: {
      type: String,
      enum: [
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
      ],
      default: "academic",
    },
    organization: { type: String, default: "", trim: true, maxlength: 150 },
    date: { type: String, default: "", trim: true, maxlength: 50 },
    year: { type: String, default: "", trim: true, maxlength: 20 },
    description: { type: String, default: "", trim: true, maxlength: 1500 },
    positionRank: { type: String, default: "", trim: true, maxlength: 100 },
    awardPrize: { type: String, default: "", trim: true, maxlength: 150 },
    teamSize: { type: Number, default: 1, min: 1, max: 200 },
    role: { type: String, default: "", trim: true, maxlength: 100 },
    location: { type: String, default: "", trim: true, maxlength: 150 },
    proofUrl: { type: String, default: "", trim: true, maxlength: 500 },
    certificateUrl: { type: String, default: "", trim: true, maxlength: 500 },
    evidenceStorageKey: { type: String, default: "", trim: true, maxlength: 500 },
    relatedProject: { type: String, default: "", trim: true, maxlength: 100 },
    skillsDemonstrated: {
      type: [{ type: String, trim: true, maxlength: 100 }],
      default: [],
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "self-reported"],
      default: "self-reported",
    },
  },
  { _id: true }
);

const ResumeMetadataSubSchema = new Schema(
  {
    storageKey: { type: String, default: "", trim: true, maxlength: 500 },
    fileName: { type: String, default: "", trim: true, maxlength: 255 },
    fileSize: { type: Number, default: 0, min: 0 },
    contentType: { type: String, default: "application/pdf", trim: true, maxlength: 100 },
    uploadedAt: { type: Date, default: null },
    resumeName: { type: String, default: "Primary Resume", trim: true, maxlength: 150 },
    targetRole: { type: String, default: "", trim: true, maxlength: 150 },
  },
  { _id: false }
);

const MediaItemSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    mediaUrl: {
      type: String,
      required: [true, "Media URL is required"],
      trim: true,
      maxlength: 500,
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "pdf", "presentation", "document", "external_media"],
      default: "image",
    },
    title: {
      type: String,
      required: [true, "Media title is required"],
      trim: true,
      maxlength: 150,
    },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    category: {
      type: String,
      enum: ["profile", "project", "research", "achievement", "other"],
      default: "project",
    },
    relatedProject: { type: String, default: "", trim: true, maxlength: 100 },
    relatedAchievement: { type: String, default: "", trim: true, maxlength: 100 },
    displayOrder: { type: Number, default: 0 },
    visibility: {
      type: String,
      enum: ["public", "private", "restricted"],
      default: "public",
    },
    isFeatured: { type: Boolean, default: false },
    altText: { type: String, default: "", trim: true, maxlength: 250 },
    fileName: { type: String, default: "", trim: true, maxlength: 255 },
    mimeType: { type: String, default: "", trim: true, maxlength: 100 },
    fileSize: { type: Number, default: 0, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const PlatformLinkSubSchema = new Schema(
  {
    id: {
      type: String,
      default: function (this: { _id?: Schema.Types.ObjectId }) {
        return this._id ? this._id.toString() : "";
      },
      trim: true,
      maxlength: 100,
    },
    platform: {
      type: String,
      required: [true, "Platform is required"],
      trim: true,
      maxlength: 100,
    },
    url: {
      type: String,
      required: [true, "URL is required"],
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      enum: ["coding", "professional", "social", "project", "research", "other"],
      default: "professional",
    },
    username: { type: String, default: "", trim: true, maxlength: 100 },
    isPrimary: { type: Boolean, default: false },
    visibility: {
      type: String,
      enum: ["public", "connections", "recruiters", "private"],
      default: "public",
    },
    verificationStatus: {
      type: String,
      enum: ["unverified", "verified", "failed", "pending"],
      default: "unverified",
    },
  },
  { _id: true }
);

const ContactsSubSchema = new Schema(
  {
    email: { type: String, default: "", trim: true, maxlength: 150 },
    phone: { type: String, default: "", trim: true, maxlength: 30 },
    countryCode: { type: String, default: "", trim: true, maxlength: 10 },
    city: { type: String, default: "", trim: true, maxlength: 100 },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    country: { type: String, default: "", trim: true, maxlength: 100 },
    visibility: {
      email: {
        type: String,
        enum: ["private", "recruiters", "public"],
        default: "private",
      },
      phone: {
        type: String,
        enum: ["private", "recruiters", "public"],
        default: "private",
      },
    },
    // Backward-compatible legacy contact links
    github: { type: String, default: "", trim: true, maxlength: 200 },
    linkedin: { type: String, default: "", trim: true, maxlength: 200 },
    twitter: { type: String, default: "", trim: true, maxlength: 200 },
    portfolio: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { _id: false }
);

const LanguageSubSchema = new Schema(
  {
    language: { type: String, required: true, trim: true, maxlength: 80 },
    proficiency: {
      type: String,
      enum: ["basic", "conversational", "fluent", "native"],
      default: "conversational",
    },
  },
  { _id: false }
);

/* =========================================================================
   Root StudentProfile Schema
   ========================================================================= */

const StudentProfileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Module 1: Personal Profile
    preferredName: { type: String, default: "", trim: true, maxlength: 100 },
    profilePhoto: { type: String, default: "", trim: true, maxlength: 500 },
    headline: { type: String, default: "", trim: true, maxlength: 200 },
    bio: { type: String, default: "", trim: true, maxlength: 3000 },
    dob: { type: String, default: "", trim: true, maxlength: 30 },
    gender: {
      type: String,
      enum: ["male", "female", "non-binary", "prefer-not-to-say", "other", ""],
      default: "",
    },
    nationality: { type: String, default: "", trim: true, maxlength: 80 },
    country: { type: String, default: "", trim: true, maxlength: 100 },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    city: { type: String, default: "", trim: true, maxlength: 100 },
    currentStatus: {
      type: String,
      enum: [
        "student",
        "internship-seeking",
        "full-time-seeking",
        "researcher",
        "freelancer",
        "employed",
        "open-to-opportunities",
        "other",
        "",
      ],
      default: "student",
    },
    careerInterests: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Career interests cannot exceed 30 items",
      ],
    },
    areasOfInterest: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Areas of interest cannot exceed 30 items",
      ],
    },
    languages: {
      type: [LanguageSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 20,
        "Languages cannot exceed 20 items",
      ],
    },

    // Legacy scalar education fields (retained for backward compatibility, NOT canonical)
    school: { type: String, default: "", trim: true, maxlength: 150 },
    degree: { type: String, default: "", trim: true, maxlength: 150 },
    gradYear: { type: String, default: "", trim: true, maxlength: 20 },
    gpa: { type: String, default: "", trim: true, maxlength: 50 },

    // Module 2: Education (Canonical array)
    education: {
      type: [EducationSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 25,
        "Education cannot exceed 25 items",
      ],
    },

    // Module 3: Projects
    projects: {
      type: [ProjectSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Projects cannot exceed 30 items",
      ],
    },

    // Module 4: Skills
    skills: {
      type: [SkillSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 60,
        "Skills cannot exceed 60 items",
      ],
    },

    // Module 5: Credentials
    credentials: {
      type: [CredentialSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Credentials cannot exceed 30 items",
      ],
    },

    // Module 6: Achievements
    achievements: {
      type: [AchievementSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Achievements cannot exceed 30 items",
      ],
    },

    // Module 7: Resume (Exactly ONE slot)
    resume: {
      type: ResumeMetadataSubSchema,
      default: () => ({
        storageKey: "",
        fileName: "",
        fileSize: 0,
        contentType: "application/pdf",
        uploadedAt: null,
        resumeName: "Primary Resume",
        targetRole: "",
      }),
    },
    resumeUrl: { type: String, default: "", trim: true, maxlength: 500 },
    resumeFileName: { type: String, default: "", trim: true, maxlength: 255 },
    resumeLastUpdated: { type: Date, default: null },

    // Module 8: Media Gallery
    media: {
      type: [MediaItemSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Media cannot exceed 30 items",
      ],
    },
    mediaUrls: {
      type: [{ type: String, trim: true, maxlength: 500 }],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Media URLs cannot exceed 30 items",
      ],
    },

    // Module 9: Links & Contacts
    links: {
      type: [PlatformLinkSubSchema],
      default: [],
      validate: [
        (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
        "Links cannot exceed 30 items",
      ],
    },
    contacts: {
      type: ContactsSubSchema,
      default: () => ({
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
      }),
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =========================================================================
   Canonical Primary Education Getter Virtual & Methods
   Note: Automatic overwrite of root education from education[0] has been removed
   to guarantee data integrity and prevent dual-write drift.
   ========================================================================= */

StudentProfileSchema.virtual("primaryEducation").get(function (this: IStudentProfile) {
  if (this.education && this.education.length > 0) {
    return this.education[0];
  }
  if (this.school || this.degree) {
    return {
      institution: this.school || "",
      degree: this.degree || "",
      gradYear: this.gradYear || "",
      gpa: this.gpa || "",
      currentStatus: "studying" as EducationStatus,
    };
  }
  return null;
});

StudentProfileSchema.methods.getPrimaryEducation = function (this: IStudentProfile) {
  if (this.education && this.education.length > 0) {
    return this.education[0];
  }
  return {
    institution: this.school || "",
    degree: this.degree || "",
    gradYear: this.gradYear || "",
    gpa: this.gpa || "",
    currentStatus: "studying" as EducationStatus,
  };
};

if (models.StudentProfile) {
  delete (models as Record<string, unknown>).StudentProfile;
}

const StudentProfile =
  models.StudentProfile || model("StudentProfile", StudentProfileSchema);

export default StudentProfile;
