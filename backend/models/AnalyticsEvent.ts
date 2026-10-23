import { Schema, model, models } from "mongoose";
import { ANALYTICS_EVENT_TYPES, ANALYTICS_RESOURCE_TYPES } from "../lib/analytics/constants";

const AnalyticsEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, maxlength: 80 },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    resourceType: { type: String, required: true, enum: ANALYTICS_RESOURCE_TYPES },
    eventType: { type: String, required: true, enum: ANALYTICS_EVENT_TYPES },
    occurredAt: { type: Date, required: true },
    path: { type: String, required: true, maxlength: 200 },
    referrerDomain: { type: String, default: null, maxlength: 120 },
    utmSource: { type: String, default: null, maxlength: 80 },
    utmMedium: { type: String, default: null, maxlength: 80 },
    utmCampaign: { type: String, default: null, maxlength: 80 },
    utmContent: { type: String, default: null, maxlength: 80 },
    utmTerm: { type: String, default: null, maxlength: 80 },
    deviceCategory: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "unknown"],
      default: "unknown",
    },
    browserFamily: { type: String, default: "Unknown", maxlength: 40 },
    osFamily: { type: String, default: "Unknown", maxlength: 40 },
    country: { type: String, default: null, maxlength: 2 },
    region: { type: String, default: null, maxlength: 80 },
    sessionId: { type: String, default: null, maxlength: 64 },
    visitorId: { type: String, default: null, maxlength: 64 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ingestedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: false, versionKey: false }
);

AnalyticsEventSchema.index({ ownerId: 1, occurredAt: -1 });
AnalyticsEventSchema.index({ resourceId: 1, occurredAt: -1 });
AnalyticsEventSchema.index({ resourceId: 1, eventType: 1, occurredAt: -1 });
AnalyticsEventSchema.index({ resourceId: 1, visitorId: 1, occurredAt: -1 });
AnalyticsEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

if (models.AnalyticsEvent) {
  delete (models as Record<string, unknown>).AnalyticsEvent;
}

const AnalyticsEvent = models.AnalyticsEvent || model("AnalyticsEvent", AnalyticsEventSchema);

export default AnalyticsEvent;
