import { Schema, model, models } from "mongoose";
import {
  certificationSchema,
  educationSchema,
  employmentSchema,
  limitedArray,
  portfolioSchema,
  skillSchema,
  stableId,
  text,
  userIdField,
  visibilitySchema,
} from "./domain/fragments";

const AchievementSchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    description: text(2000),
    organization: text(150),
    date: text(10),
    evidenceUrl: text(500),
    assetId: text(32),
  },
  { _id: true }
);

const SocialLinkSchema = new Schema(
  {
    id: stableId,
    platform: text(80, true),
    url: text(500, true),
    label: text(80),
  },
  { _id: true }
);

const ResumeSchema = new Schema(
  {
    fileName: text(255),
    storageKey: text(300),
    assetId: text(32),
    contentType: {
      type: String,
      enum: ["", "application/pdf"],
      default: "",
      trim: true,
    },
    targetRole: text(120),
    uploadedAt: { type: Date, default: null },
  },
  { _id: false }
);

const ContactSchema = new Schema(
  {
    email: text(200),
    phone: text(30),
    city: text(100),
    country: text(100),
    linkedin: text(500),
    website: text(500),
    visibility: { type: visibilitySchema(false), default: () => ({ email: "private", phone: "private" }) },
  },
  { _id: false }
);

const ProfessionalProfileSchema = new Schema(
  {
    userId: userIdField,
    headline: text(200),
    bio: text(3000),
    currentEmployment: {
      type: employmentSchema(false, false),
      default: () => ({
        company: "",
        jobTitle: "",
        employmentType: "",
        location: "",
        startDate: "",
        endDate: "",
        isCurrent: false,
        responsibilities: [],
        achievements: [],
      }),
    },
    employmentHistory: limitedArray(employmentSchema(true, true), 30),
    skills: limitedArray(skillSchema(), 60),
    certifications: limitedArray(certificationSchema(), 30),
    education: limitedArray(educationSchema(), 20),
    portfolio: limitedArray(portfolioSchema(), 30),
    achievements: limitedArray(AchievementSchema, 40),
    socialLinks: limitedArray(SocialLinkSchema, 20),
    resume: {
      type: ResumeSchema,
      default: () => ({
        fileName: "",
        storageKey: "",
        contentType: "",
        targetRole: "",
        uploadedAt: null,
      }),
    },
    contact: {
      type: ContactSchema,
      default: () => ({
        email: "",
        phone: "",
        city: "",
        country: "",
        linkedin: "",
        website: "",
        visibility: { email: "private", phone: "private" },
      }),
    },
  },
  { timestamps: true, strict: true }
);

if (models.ProfessionalProfile) {
  delete (models as Record<string, unknown>).ProfessionalProfile;
}

const ProfessionalProfile = models.ProfessionalProfile || model("ProfessionalProfile", ProfessionalProfileSchema);

export default ProfessionalProfile;
