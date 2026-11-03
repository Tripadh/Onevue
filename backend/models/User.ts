import { Schema, model, models } from "mongoose";

export type IdentityType = "student" | "professional" | "freelancer" | "creator" | "business";

export type UserRole = "super_admin" | "admin" | "moderator" | "user";
export type AccountStatus = "active" | "suspended" | "blocked" | "deleted" | "pending";

export type DiscoverySourceType =
  | "google_search"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "facebook"
  | "x_twitter"
  | "reddit"
  | "friend_family"
  | "college_university"
  | "online_advertisement"
  | "blog_article"
  | "developer_community"
  | "other";

export interface ISurvey {
  discoverySource: DiscoverySourceType;
  otherDetails?: string | null;
  completedAt: Date;
}

export interface IOnboarding {
  survey?: ISurvey;
  surveyCompleted: boolean;
}

export interface IUser {
  email: string;
  password?: string;
  name: string;
  username?: string | null;
  identity?: IdentityType;
  role?: UserRole;
  status?: AccountStatus;
  blockedUntil?: Date | null;
  blockedAt?: Date | null;
  blockedByAdminId?: Schema.Types.ObjectId | string | null;
  deletedAt?: Date | null;
  deletedByAdminId?: Schema.Types.ObjectId | string | null;
  customPermissions?: Record<string, string[]>;
  bio?: string | null;
  location?: string | null;
  profilePhotoKey?: string | null;
  profilePhotoUpdatedAt?: Date | null;
  onboarding?: IOnboarding;
  createdAt?: Date;
  updatedAt?: Date;
}

const SurveySchema = new Schema(
  {
    discoverySource: {
      type: String,
      enum: [
        "google_search",
        "instagram",
        "youtube",
        "linkedin",
        "facebook",
        "x_twitter",
        "reddit",
        "friend_family",
        "college_university",
        "online_advertisement",
        "blog_article",
        "developer_community",
        "other",
      ],
      required: true,
      trim: true,
      lowercase: true,
    },
    otherDetails: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

const OnboardingSchema = new Schema(
  {
    survey: {
      type: SurveySchema,
      default: null,
    },
    surveyCompleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    email: {
      type: String,
      unique: true,
      required: [true, "Email is required"],
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.[a-zA-Z]{2,})+$/,
        "Email is invalid",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
    },
    identity: {
      type: String,
      enum: ["student", "professional", "freelancer", "creator", "business"],
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["super_admin", "admin", "moderator", "user"],
      default: "user",
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "blocked", "deleted", "pending"],
      default: "active",
      lowercase: true,
      trim: true,
      index: true,
    },
    blockedUntil: {
      type: Date,
      default: null,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    blockedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    customPermissions: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      default: null,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
    profilePhotoKey: {
      type: String,
      default: null,
    },
    profilePhotoUpdatedAt: {
      type: Date,
      default: null,
    },
    onboarding: {
      type: OnboardingSchema,
      default: () => ({ surveyCompleted: false, survey: null }),
    },
  },
  {
    timestamps: true,
  }
);

if (models.User && (!models.User.schema.paths["role"] || !models.User.schema.paths["status"] || !models.User.schema.paths["blockedUntil"] || !models.User.schema.paths["onboarding.surveyCompleted"])) {
  delete (models as Record<string, unknown>).User;
}

const User = models.User || model("User", UserSchema);

export default User;
