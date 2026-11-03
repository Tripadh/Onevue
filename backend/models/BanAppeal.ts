import { Schema, model, models } from "mongoose";

export interface IBanAppeal {
  appealingUserId: Schema.Types.ObjectId | string;
  originalBanReason?: string;
  originalBanDate?: Date;
  originalBanningAdminId?: Schema.Types.ObjectId | string | null;
  appealMessage: string;
  contactEmail?: string;
  appealStatus: "pending" | "approved" | "rejected";
  reviewedByAdminId?: Schema.Types.ObjectId | string | null;
  reviewReason?: string | null;
  reviewedAt?: Date | null;
  appealedAt: Date;
}

const BanAppealSchema = new Schema<IBanAppeal>(
  {
    appealingUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    originalBanReason: {
      type: String,
      default: "",
    },
    originalBanDate: {
      type: Date,
      default: null,
    },
    originalBanningAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    appealMessage: {
      type: String,
      required: true,
      trim: true,
      minlength: [10, "Appeal statement must be at least 10 characters long"],
      maxlength: 3000,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    appealStatus: {
      type: String,
      required: true,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewReason: {
      type: String,
      default: null,
      trim: true,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    appealedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  }
);

BanAppealSchema.index({ appealStatus: 1, appealedAt: -1 });
BanAppealSchema.index({ appealingUserId: 1, appealStatus: 1 });

const BanAppeal = models.BanAppeal || model<IBanAppeal>("BanAppeal", BanAppealSchema);

export default BanAppeal;

