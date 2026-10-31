import { Schema, model, models, Types } from "mongoose";

export type SessionRevokeReason =
  | "logout"
  | "logout-all"
  | "reuse-detected"
  | "password-changed"
  | "suspended"
  | "account-deleted";

export interface IAuthSession {
  userId: Types.ObjectId;
  sessionId: string;
  familyId: string;
  tokenHash: string;
  csrfTokenHash: string;
  previousTokenHash?: string;
  previousTokenRotatedAt?: Date | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokeReason?: SessionRevokeReason | null;
  userAgentSummary?: string;
  ipHash?: string;
  deviceLabel?: string;
}

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    csrfTokenHash: { type: String, required: true },
    previousTokenHash: { type: String, default: null, index: true },
    previousTokenRotatedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null, index: true },
    revokeReason: { type: String, default: null },
    userAgentSummary: { type: String, maxlength: 300 },
    ipHash: { type: String, maxlength: 128 },
    deviceLabel: { type: String, maxlength: 100 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthSessionSchema.index({ userId: 1, revokedAt: 1 });

const AuthSession = models.AuthSession || model<IAuthSession>("AuthSession", AuthSessionSchema);

export default AuthSession;
