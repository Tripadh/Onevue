import { Schema, model, models } from "mongoose";

export type AuditSeverity = "info" | "warning" | "critical";
export type AuditStatus = "SUCCESS" | "FAILURE";

export interface IAuditActor {
  userId?: string | null;
  email: string;
  role: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IAuditTarget {
  entityType: string;
  entityId?: string | null;
  label?: string | null;
}

export interface IAuditLog {
  timestamp: Date;
  eventType: string;
  domain: string;
  severity: AuditSeverity;
  status: AuditStatus;
  actor: IAuditActor;
  target?: IAuditTarget;
  actionSummary: string;
  changes?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

const AuditActorSchema = new Schema<IAuditActor>(
  {
    userId: { type: String, default: null },
    email: { type: String, required: true },
    role: { type: String, required: true },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { _id: false }
);

const AuditTargetSchema = new Schema<IAuditTarget>(
  {
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    label: { type: String, default: null },
  },
  { _id: false }
);

const AuditLogSchema = new Schema<IAuditLog>(
  {
    timestamp: {
      type: Date,
      default: Date.now,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
      index: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILURE"],
      default: "SUCCESS",
      index: true,
    },
    actor: {
      type: AuditActorSchema,
      required: true,
    },
    target: {
      type: AuditTargetSchema,
      default: null,
    },
    actionSummary: {
      type: String,
      required: true,
      trim: true,
    },
    changes: {
      before: { type: Schema.Types.Mixed, default: null },
      after: { type: Schema.Types.Mixed, default: null },
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

AuditLogSchema.index({ domain: 1, timestamp: -1 });
AuditLogSchema.index({ severity: 1, timestamp: -1 });
AuditLogSchema.index({ eventType: 1, timestamp: -1 });
// Atlas Free Tier protection: Automatically prune audit records older than 90 days
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

if (models.AuditLog) {
  delete (models as Record<string, unknown>).AuditLog;
}

const AuditLog = models.AuditLog || model<IAuditLog>("AuditLog", AuditLogSchema);
export default AuditLog;
