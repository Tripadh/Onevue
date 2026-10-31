import { Schema, model, models, Types } from "mongoose";

export type AuthProvider = "password" | "google";

export interface IAuthAccount {
  userId: Types.ObjectId;
  provider: AuthProvider;
  providerSubject: string;
  providerEmail?: string;
  emailVerified: boolean;
  linkedAt: Date;
}

const AuthAccountSchema = new Schema<IAuthAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["password", "google"], required: true },
    providerSubject: { type: String, required: true },
    providerEmail: { type: String, lowercase: true, trim: true },
    emailVerified: { type: Boolean, required: true, default: false },
    linkedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false }
);

AuthAccountSchema.index({ provider: 1, providerSubject: 1 }, { unique: true });
AuthAccountSchema.index({ userId: 1, provider: 1 }, { unique: true });

const AuthAccount = models.AuthAccount || model<IAuthAccount>("AuthAccount", AuthAccountSchema);

export default AuthAccount;
