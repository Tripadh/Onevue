import { Schema, model, models } from "mongoose";

/* =========================================================================
   OneVue Template Ingestion & Review Model (Phase 5.1)
   ========================================================================= */

export type IngestionReviewStatus = "pending_review" | "approved" | "rejected";
export type ProvisioningStatus = "unprovisioned" | "in_progress" | "provisioned" | "failed";

export interface IReviewDecision {
  decision: "approve" | "reject";
  reviewerUserId: Schema.Types.ObjectId;
  reason?: string;
  timestamp: Date;
}

/**
 * Append-only history of review events for one ingestion.
 *
 * `reviewDecision` holds the current decision; this list keeps every decision
 * and every hand-off to human review, so an audit trail survives a later
 * decision, a retry or a workflow restart.
 */
export interface IReviewHistoryEntry {
  decision: string;
  reviewerUserId?: Schema.Types.ObjectId | null;
  reason?: string;
  auditOutcome?: string;
  timestamp: Date;
}

export interface IProvisioningRecord {
  status: ProvisioningStatus;
  destinationOrg: string;
  destinationRepo?: string;
  destinationUrl?: string;
  destinationCommitSha?: string;
  visibility: string;
  provisionedAt?: Date;
  error?: string;
  errorCategory?: string;
  provenance?: any;
}

export interface ITemplateIngestionReview {
  _id?: Schema.Types.ObjectId | string;
  ingestionId: string;
  adminUserId: Schema.Types.ObjectId;
  sourceUrl: string;
  commitSha: string;
  templateId?: string;
  templateVersion?: string;
  sourceSnapshot?: any;
  auditReport: any;
  status: IngestionReviewStatus;
  reviewDecision?: IReviewDecision;
  /** Append-only review history; never rewritten by a later decision. */
  reviewHistory?: IReviewHistoryEntry[];
  provisioningRecord?: IProvisioningRecord;
  /** Canonical repository identity, e.g. 'owner/repo' (lowercase). */
  repositoryKey?: string;
  repository?: { owner: string; repo: string; canonicalUrl: string };
  requestedRef?: string;
  previousCommitSha?: string;
  previousVersion?: string;
  /** Phase 5.15 workflow status (processing, catalog_eligible, audit_rejected, ...). */
  submissionStatus?: string;
  /** How the source was retrieved; never the credential itself. */
  sourceAuthMode?: "public" | "credentialed";
  /** Cross-process repository lease (only set on `repo_lock:` documents). */
  lockOwnerToken?: string;
  lockLeaseExpiresAt?: Date;
  stages?: Array<{ stage: string; status: string; detail?: string; at: string }>;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReviewDecisionSubSchema = new Schema(
  {
    decision: { type: String, enum: ["approve", "reject"], required: true, lowercase: true, trim: true },
    reviewerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "", trim: true, maxlength: 1000 },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  { _id: false }
);

const ReviewHistoryEntrySubSchema = new Schema(
  {
    decision: { type: String, required: true, trim: true, lowercase: true },
    reviewerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "", trim: true, maxlength: 1000 },
    auditOutcome: { type: String, default: "", trim: true },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  { _id: false }
);

const ProvisioningRecordSubSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["unprovisioned", "in_progress", "provisioned", "failed"],
      default: "unprovisioned",
      lowercase: true,
      trim: true,
    },
    destinationOrg: { type: String, default: "qubort-tech", trim: true },
    destinationRepo: { type: String, default: "", trim: true },
    destinationUrl: { type: String, default: "", trim: true },
    destinationCommitSha: { type: String, default: "", trim: true },
    visibility: { type: String, default: "private", trim: true },
    provisionedAt: { type: Date, default: null },
    error: { type: String, default: "", trim: true },
    errorCategory: { type: String, default: "", trim: true },
    provenance: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const TemplateIngestionReviewSchema = new Schema(
  {
    ingestionId: {
      type: String,
      required: [true, "ingestionId is required"],
      unique: true,
      index: true,
      trim: true,
    },
    adminUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "adminUserId is required"],
      index: true,
    },
    sourceUrl: {
      type: String,
      required: [true, "sourceUrl is required"],
      trim: true,
      maxlength: 500,
    },
    commitSha: {
      type: String,
      required: [true, "commitSha is required"],
      trim: true,
      minlength: 40,
      maxlength: 40,
      match: [/^[a-f0-9]{40}$/i, "commitSha must be a 40-character hexadecimal string"],
    },
    templateId: {
      type: String,
      trim: true,
      maxlength: 64,
      default: undefined,
    },
    templateVersion: {
      type: String,
      trim: true,
      maxlength: 32,
      default: undefined,
    },
    sourceSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },
    auditReport: {
      type: Schema.Types.Mixed,
      required: [true, "auditReport is required"],
    },
    status: {
      type: String,
      enum: ["pending_review", "approved", "rejected"],
      default: "pending_review",
      lowercase: true,
      trim: true,
      index: true,
    },
    reviewDecision: {
      type: ReviewDecisionSubSchema,
      default: null,
    },
    reviewHistory: {
      type: [ReviewHistoryEntrySubSchema],
      default: [],
    },
    repositoryKey: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      default: undefined,
    },
    repository: {
      owner: { type: String, trim: true },
      repo: { type: String, trim: true },
      canonicalUrl: { type: String, trim: true },
    },
    requestedRef: { type: String, trim: true, default: "" },
    previousCommitSha: { type: String, trim: true, default: undefined },
    previousVersion: { type: String, trim: true, default: undefined },
    submissionStatus: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },
    sourceAuthMode: {
      type: String,
      trim: true,
      enum: ["public", "credentialed"],
      default: undefined,
    },
    lockOwnerToken: { type: String, trim: true, default: "" },
    lockLeaseExpiresAt: { type: Date, default: null },
    stages: {
      type: [
        new Schema(
          {
            stage: { type: String, required: true },
            status: { type: String, required: true },
            detail: { type: String, default: "" },
            at: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    error: { type: String, default: "", trim: true },
    provisioningRecord: {
      type: ProvisioningRecordSubSchema,
      default: () => ({
        status: "unprovisioned",
        destinationOrg: "qubort-tech",
        destinationRepo: "",
        destinationUrl: "",
        visibility: "private",
        provisionedAt: null,
        error: "",
        errorCategory: "",
        provenance: null,
      }),
    },
  },
  {
    timestamps: true,
  }
);

// Hot-reload-safe model registration
if (models.TemplateIngestionReview) {
  delete (models as Record<string, unknown>).TemplateIngestionReview;
}

const TemplateIngestionReview =
  models.TemplateIngestionReview ||
  model("TemplateIngestionReview", TemplateIngestionReviewSchema);

export default TemplateIngestionReview;
