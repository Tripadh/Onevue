import { Schema, model, models } from "mongoose";

export interface IUserWarningHistory {
  warnedUserId: Schema.Types.ObjectId | string;
  warningTemplateId?: Schema.Types.ObjectId | string | null;
  warningMessage: string;
  adminId: Schema.Types.ObjectId | string;
  isAnonymous: boolean;
  severityLevel: "low" | "medium" | "high";
  warnedAt: Date;
  acknowledgedAt?: Date | null;
}

const UserWarningHistorySchema = new Schema<IUserWarningHistory>(
  {
    warnedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    warningTemplateId: {
      type: Schema.Types.ObjectId,
      ref: "WarningTemplate",
      default: null,
    },
    warningMessage: {
      type: String,
      required: true,
      trim: true,
      minlength: [5, "Warning message must be at least 5 characters"],
      maxlength: 2000,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isAnonymous: {
      type: Boolean,
      default: true,
    },
    severityLevel: {
      type: String,
      required: true,
      enum: ["low", "medium", "high"],
      default: "medium",
      index: true,
    },
    warnedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: false,
  }
);

UserWarningHistorySchema.index({ warnedUserId: 1, warnedAt: -1 });

const UserWarningHistory =
  models.UserWarningHistory ||
  model<IUserWarningHistory>("UserWarningHistory", UserWarningHistorySchema);

export default UserWarningHistory;

