import { Schema, model, models } from "mongoose";

export interface IUserAccountStatusHistory {
  userId: Schema.Types.ObjectId | string;
  previousStatus?: string | null;
  newStatus: string; // 'active' | 'blocked' | 'suspended' | 'deleted'
  changedByAdminId: Schema.Types.ObjectId | string;
  changeReason: string; // Must be at least 10 characters
  changeNotes?: string | null;
  suspensionDurationDays?: number | null;
  suspensionExpiresAt?: Date | null;
  canAppeal: boolean;
  changedAt: Date;
}

const UserAccountStatusHistorySchema = new Schema<IUserAccountStatusHistory>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    previousStatus: {
      type: String,
      default: "active",
    },
    newStatus: {
      type: String,
      required: true,
      enum: ["active", "blocked", "suspended", "deleted", "pending"],
      index: true,
    },
    changedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    changeReason: {
      type: String,
      required: true,
      minlength: [10, "Reason must be at least 10 characters long"],
      trim: true,
    },
    changeNotes: {
      type: String,
      default: null,
      trim: true,
    },
    suspensionDurationDays: {
      type: Number,
      default: null,
    },
    suspensionExpiresAt: {
      type: Date,
      default: null,
    },
    canAppeal: {
      type: Boolean,
      default: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound index for timeline queries
UserAccountStatusHistorySchema.index({ userId: 1, changedAt: -1 });

// Prevent updates to enforce immutability
UserAccountStatusHistorySchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  throw new Error("UserAccountStatusHistory records are immutable and cannot be updated.");
});

if (models.UserAccountStatusHistory) {
  delete (models as Record<string, unknown>).UserAccountStatusHistory;
}

const UserAccountStatusHistory =
  models.UserAccountStatusHistory ||
  model<IUserAccountStatusHistory>("UserAccountStatusHistory", UserAccountStatusHistorySchema);

export default UserAccountStatusHistory;

