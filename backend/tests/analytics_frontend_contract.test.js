const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

describe("analytics frontend contract", () => {
  test("owner dashboard renders API metrics and honest states", () => {
    const page = fs.readFileSync(path.join(root, "frontend", "components", "dashboard", "student", "StudentAnalyticsPage.jsx"), "utf8");
    for (const marker of ["Loading analytics", "Retry", "You do not have access", "No analytics events", "getOverview", "getResources", "getEvents", "exportReport", "useSearchParams", "Compare previous period"]) {
      assert.equal(page.includes(marker), true, marker);
    }
    assert.equal(page.includes("Math.random"), false);
  });

  test("public visiting card tracks the published resource id", () => {
    const page = fs.readFileSync(path.join(root, "frontend", "components", "dashboard", "student", "PublicVisitingCard.jsx"), "utf8");
    assert.equal(page.includes("OneVueAnalytics.createTracker"), true);
    assert.equal(page.includes("ownerId"), false);
  });

  test("portfolio tracker fails closed and the shared collector honors consent", () => {
    const tracker = fs.readFileSync(path.join(root, "portfolio", "src", "components", "portfolio-analytics.tsx"), "utf8");
    assert.equal(tracker.includes("createPortfolioTracker"), true);
    assert.equal(tracker.includes("catch"), true);
    const sdk = require(path.join(root, "frontend", "services", "onevue-analytics.js"));
    const event = sdk.buildEvent({ resourceId: "abc", resourceType: "visiting_card", path: "/card/alex", consent: false }, "page_view");
    assert.equal(event.visitorId, null);
    assert.equal(event.sessionId, null);
    assert.equal("ownerId" in event, false);
  });
});
