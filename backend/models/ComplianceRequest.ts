import { Schema, model, models } from "mongoose";

export interface IComplianceRequest {
  requestType: "gdpr_deletion" | "right_to_access";
  userId: Schema.Types.ObjectId | string;
  requestStatus: "pending" | "processing" | "completed" | "rejected";
  requestedAt: Date;
  processedByAdminId?: Schema.Types.ObjectId | string | null;
  processedAt?: Date | null;
  completionDate?: Date | null;
  retentionPeriodDays?: number | null;
  scheduledDeletionDate?: Date | null;
  notes?: string | null;
}

const ComplianceRequestSchema = new Schema<IComplianceRequest>(
  {
    requestType: {
      type: String,
      required: true,
      enum: ["gdpr_deletion", "right_to_access"],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requestStatus: {
      type: String,
      required: true,
      enum: ["pending", "processing", "completed", "rejected"],
      default: "pending",
      index: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    processedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    completionDate: {
      type: Date,
      default: null,
    },
    retentionPeriodDays: {
      type: Number,
      default: 30,
    },
    scheduledDeletionDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: false,
  }
);

ComplianceRequestSchema.index({ requestType: 1, requestStatus: 1 });
ComplianceRequestSchema.index({ userId: 1, requestedAt: -1 });

const ComplianceRequest =
  models.ComplianceRequest ||
  model<IComplianceRequest>("ComplianceRequest", ComplianceRequestSchema);

export default ComplianceRequest;

