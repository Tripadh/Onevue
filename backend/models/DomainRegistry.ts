import { Schema, model, models } from "mongoose";

export interface IDomainRegistry {
  domainKey: string;             // e.g. "domain.users", "domain.visiting_card"
  name: string;                  // e.g. "Users & Identities"
  description?: string;
  allowedActions: string[];       // ["read", "write", "create", "delete", "publish", "manage"]
  isSystem: boolean;             // system-defined vs custom user-added
  isActive: boolean;
  order?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const DomainRegistrySchema = new Schema<IDomainRegistry>(
  {
    domainKey: {
      type: String,
      required: [true, "Domain key is required"],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Domain name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    allowedActions: {
      type: [String],
      default: ["read", "write", "create", "delete", "publish", "manage"],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

if (models.DomainRegistry) {
  delete (models as Record<string, unknown>).DomainRegistry;
}

const DomainRegistry =
  models.DomainRegistry ||
  model<IDomainRegistry>("DomainRegistry", DomainRegistrySchema);

export default DomainRegistry;
