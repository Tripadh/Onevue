import { Schema, model, models } from "mongoose";

export interface IWarningTemplate {
  title: string;
  category: "terms_of_service" | "spam" | "inappropriate_content" | "harassment" | "general";
  message: string;
  severityLevel: "low" | "medium" | "high";
  isActive: boolean;
  createdByAdminId?: Schema.Types.ObjectId | string;
  createdAt?: Date;
  updatedAt?: Date;
}

const WarningTemplateSchema = new Schema<IWarningTemplate>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    category: {
      type: String,
      required: true,
      enum: ["terms_of_service", "spam", "inappropriate_content", "harassment", "general"],
      default: "general",
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    severityLevel: {
      type: String,
      required: true,
      enum: ["low", "medium", "high"],
      default: "medium",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const DEFAULT_WARNING_TEMPLATES = [
  {
    title: "First Policy Warning - Inappropriate Content",
    category: "inappropriate_content",
    severityLevel: "low",
    message: "Your profile contains content that violates OneVue community standards. Please update your visiting card and profile details within 48 hours to avoid account suspension.",
  },
  {
    title: "Spam & Automated Activity Warning",
    category: "spam",
    severityLevel: "medium",
    message: "Unusual automated requests or promotional spam have been detected from your account. Continued behavior will lead to an immediate temporary suspension.",
  },
  {
    title: "Terms of Service Violation - Final Warning",
    category: "terms_of_service",
    severityLevel: "high",
    message: "This is a final warning regarding serious violations of OneVue Terms of Service. Failure to comply immediately will result in permanent account termination without further notice.",
  },
];

const WarningTemplate = models.WarningTemplate || model<IWarningTemplate>("WarningTemplate", WarningTemplateSchema);

export default WarningTemplate;

