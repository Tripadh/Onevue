import { Schema, model, models } from "mongoose";

/* =========================================================================
   OneVue Website Configuration Model
   ========================================================================= */

export type WebsiteStatus = "draft" | "published" | "suspended";
export type WebsiteThemeMode = "light" | "dark" | "system";

export const APPROVED_TEMPLATES = ["magicui-portfolio"] as const;
export type ApprovedTemplateId = (typeof APPROVED_TEMPLATES)[number];

export interface IWebsiteCustomization {
  accentColor?: string;
  themeMode?: WebsiteThemeMode;
  visibleSections?: string[];
}

export interface IUserWebsiteConfig {
  _id?: Schema.Types.ObjectId | string;
  userId: Schema.Types.ObjectId;
  username: string;
  selectedTemplateId: string;
  selectedTemplateVersion: string;
  customization?: IWebsiteCustomization;
  activeRevisionId?: Schema.Types.ObjectId | null;
  publishedAt?: Date | null;
  status: WebsiteStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const CustomizationSubSchema = new Schema(
  {
    accentColor: {
      type: String,
      default: "#3b82f6",
      trim: true,
      match: [/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex accent color"],
    },
    themeMode: {
      type: String,
      enum: ["light", "dark", "system"],
      default: "system",
    },
    visibleSections: {
      type: [String],
      default: ["about", "education", "projects", "skills", "achievements", "contact"],
    },
  },
  { _id: false }
);

const UserWebsiteConfigSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      unique: true,
      index: true,
    },
    username: {
      type: String,
      required: [true, "username is required"],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      match: [
        /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/,
        "Username must start and end with an alphanumeric character and contain only lowercase letters, numbers, periods, dashes, or underscores",
      ],
      index: true,
    },
    selectedTemplateId: {
      type: String,
      required: [true, "selectedTemplateId is required"],
      default: "magicui-portfolio",
      enum: {
        values: APPROVED_TEMPLATES,
        message: "Template '{VALUE}' is not in the approved template registry",
      },
    },
    selectedTemplateVersion: {
      type: String,
      required: [true, "selectedTemplateVersion is required"],
      default: "1.0.0",
      trim: true,
    },
    customization: {
      type: CustomizationSubSchema,
      default: () => ({
        accentColor: "#3b82f6",
        themeMode: "system",
        visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
      }),
    },
    activeRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "PublishedProfileRevision",
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["draft", "published", "suspended"],
      default: "draft",
    },
  },
  {
    timestamps: true,
  }
);

// Hot-reload-safe model registration
if (models.UserWebsiteConfig) {
  delete (models as Record<string, unknown>).UserWebsiteConfig;
}

const UserWebsiteConfig =
  models.UserWebsiteConfig || model("UserWebsiteConfig", UserWebsiteConfigSchema);

export default UserWebsiteConfig;
