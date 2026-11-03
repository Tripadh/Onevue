import { Schema, model, models } from "mongoose";

export interface IAdminSession {
  adminId: Schema.Types.ObjectId | string;
  sessionToken: string;
  ipAddress: string;
  userAgent?: string | null;
  deviceInfo?: Record<string, unknown>;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  isActive: boolean;
  revokedAt?: Date | null;
  revokedByAdminId?: Schema.Types.ObjectId | string | null;
  revokeReason?: string | null;
}

const AdminSessionSchema = new Schema<IAdminSession>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
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
    deviceInfo: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    revokeReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// TTL index to automatically prune expired sessions from Atlas Free Tier storage
AdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AdminSessionSchema.index({ adminId: 1, isActive: 1 });

if (models.AdminSession) {
  delete (models as Record<string, unknown>).AdminSession;
}

const AdminSession = models.AdminSession || model<IAdminSession>("AdminSession", AdminSessionSchema);

export default AdminSession;

