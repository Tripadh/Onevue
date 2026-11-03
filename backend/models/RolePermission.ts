import { Schema, model, models } from "mongoose";

export interface IDomainPermission {
  domainKey: string;
  actions: string[]; // ["read", "write", "create", "delete", "publish", "manage"] or ["*"]
}

export interface IRolePermission {
  role: string;                  // "super_admin" | "admin" | "moderator" | custom
  name: string;
  description?: string;
  isSystemRole: boolean;
  permissions: IDomainPermission[];
  createdAt?: Date;
  updatedAt?: Date;
}

const DomainPermissionSchema = new Schema<IDomainPermission>(
  {
    domainKey: {
      type: String,
      required: true,
      trim: true,
    },
    actions: {
      type: [String],
      default: ["read"],
    },
  },
  { _id: false }
);

const RolePermissionSchema = new Schema<IRolePermission>(
  {
    role: {
      type: String,
      required: [true, "Role identifier is required"],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Role display name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    isSystemRole: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: [DomainPermissionSchema],
      default: [],
    },
  },
  { timestamps: true }
);

if (models.RolePermission) {
  delete (models as Record<string, unknown>).RolePermission;
}

const RolePermission =
  models.RolePermission ||
  model<IRolePermission>("RolePermission", RolePermissionSchema);

export default RolePermission;
