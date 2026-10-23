import assert from "node:assert/strict";
import test from "node:test";
import { ANALYTICS_SDK_VERSION, buildAnalyticsEvent } from "../src/lib/onevue-analytics.ts";

test("portfolio analytics event keeps the visitor id when consent is granted", () => {
  const event = buildAnalyticsEvent({
    resourceId: "507f1f77bcf86cd799439011",
    path: "/p/alex",
    eventType: "page_view",
    consent: true,
  });
  assert.equal(event.sdkVersion, ANALYTICS_SDK_VERSION);
  assert.equal(event.resourceType, "portfolio");
  assert.ok(event.visitorId);
  assert.equal("ownerId" in event, false);
});

test("portfolio analytics event strips identifiers when consent is false", () => {
  const event = buildAnalyticsEvent({
    resourceId: "507f1f77bcf86cd799439011",
    path: "/p/alex",
    eventType: "page_view",
    consent: false,
  });
  assert.equal(event.visitorId, null);
  assert.equal(event.sessionId, null);
  assert.equal(event.consent, false);
});
