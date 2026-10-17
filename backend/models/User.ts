import { Schema, model, models } from "mongoose";

export type IdentityType = "student" | "professional" | "freelancer" | "creator" | "business";

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
  identity?: IdentityType;
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
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
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
    onboarding: {
      type: OnboardingSchema,
      default: () => ({ surveyCompleted: false, survey: null }),
    },
  },
  {
    timestamps: true,
  }
);

if (models.User && !models.User.schema.paths["onboarding.surveyCompleted"]) {
  delete (models as Record<string, unknown>).User;
}

const User = models.User || model("User", UserSchema);

export default User;
