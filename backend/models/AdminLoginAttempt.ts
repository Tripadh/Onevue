import { Schema, model, models } from "mongoose";

export interface IAdminLoginAttempt {
  email: string;
  ipAddress: string;
  userAgent?: string | null;
  success: boolean;
  failureReason?: string | null;
  twoFaVerified: boolean;
  attemptedAt: Date;
}

const AdminLoginAttemptSchema = new Schema<IAdminLoginAttempt>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    ipAddress: {
      type: String,
      required: true,
      default: "127.0.0.1",
      index: true,
    },
    userAgent: {
      type: String,
      default: "unknown",
    },
    success: {
      type: Boolean,
      required: true,
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
    twoFaVerified: {
      type: Boolean,
      default: false,
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Indexes
AdminLoginAttemptSchema.index({ email: 1, attemptedAt: -1 });
AdminLoginAttemptSchema.index({ ipAddress: 1, attemptedAt: -1 });
// TTL index: 30 days automatic cleanup (2592000 seconds)
AdminLoginAttemptSchema.index({ attemptedAt: 1 }, { expireAfterSeconds: 2592000 });

if (models.AdminLoginAttempt) {
  delete (models as Record<string, unknown>).AdminLoginAttempt;
}

const AdminLoginAttempt =
  models.AdminLoginAttempt ||
  model<IAdminLoginAttempt>("AdminLoginAttempt", AdminLoginAttemptSchema);

export default AdminLoginAttempt;

