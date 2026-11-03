import { Schema, model, models } from "mongoose";

export type AdminDataAccessType =
  | "view"
  | "search"
  | "export"
  | "download"
  | "view_audit_log"
  | "view_change_history"
  | "view_warnings"
  | "send_warning"
  | "view_appeals_queue";

export interface IAdminDataAccessLog {
  adminId: Schema.Types.ObjectId | string;
  accessedUserId?: string | null;
  accessType: AdminDataAccessType;
  dataFieldsAccessed: string[];
  ipAddress: string;
  userAgent?: string | null;
  reason?: string | null;
  accessedAt: Date;
}

const AdminDataAccessLogSchema = new Schema<IAdminDataAccessLog>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    accessedUserId: {
      type: Schema.Types.Mixed,
      default: null,
      index: true,
    },
    accessType: {
      type: String,
      required: true,
      enum: [
        "view",
        "search",
        "export",
        "download",
        "view_audit_log",
        "view_change_history",
        "view_warnings",
        "send_warning",
        "view_appeals_queue",
      ],
      index: true,
    },
    dataFieldsAccessed: {
      type: [String],
      default: [],
    },
    ipAddress: {
      type: String,
      required: true,
      default: "127.0.0.1",
    },
    userAgent: {
      type: String,
      default: "unknown",
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    accessedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Indexes
AdminDataAccessLogSchema.index({ adminId: 1, accessedAt: -1 });
AdminDataAccessLogSchema.index({ accessedUserId: 1, accessedAt: -1 });
// TTL index: 90 days automatic cleanup for Atlas Free Tier protection (7776000 seconds)
AdminDataAccessLogSchema.index({ accessedAt: 1 }, { expireAfterSeconds: 7776000 });

// Immutability
AdminDataAccessLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  throw new Error("AdminDataAccessLog records are immutable and cannot be updated.");
});

if (models.AdminDataAccessLog) {
  delete (models as Record<string, unknown>).AdminDataAccessLog;
}

const AdminDataAccessLog =
  models.AdminDataAccessLog ||
  model<IAdminDataAccessLog>("AdminDataAccessLog", AdminDataAccessLogSchema);

export default AdminDataAccessLog;

