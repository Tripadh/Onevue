const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "..");
const ts = require(path.join(projectRoot, "node_modules", "typescript"));

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(compiled.outputText, filename);
  };
}

const { relativeChange } = require(path.join(projectRoot, "lib", "analytics", "aggregate.ts"));
const dates = require(path.join(projectRoot, "lib", "analytics", "dates.ts"));
const privacy = require(path.join(projectRoot, "lib", "analytics", "privacy.ts"));

describe("analytics pure helpers", () => {
  test("UTC and Asia/Kolkata day boundaries", () => {
    assert.equal(dates.zonedStartToUtc("2026-01-01", "UTC").toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(dates.zonedStartToUtc("2026-01-01", "Asia/Kolkata").toISOString(), "2025-12-31T18:30:00.000Z");
    assert.throws(() => dates.parseAnalyticsRange(new URLSearchParams("from=2026-02-02&to=2026-01-01")), /start date/);
  });

  test("privacy minimization", () => {
    assert.equal(privacy.isObviousBot("Mozilla/5.0 Googlebot"), true);
    assert.equal(privacy.isObviousBot("Mozilla/5.0 Chrome"), false);
    assert.equal(privacy.referrerDomain("https://news.example/path?token=secret"), "news.example");
    assert.equal(privacy.normalizeUtm({ medium: "bad medium!" }).medium, null);
    assert.equal(privacy.normalizeUtm({ medium: "bad medium" }).medium, "bad_medium");
    assert.equal(privacy.sanitizeMetadata({ email: "a@b.com", action: "resume" }).email, undefined);
    assert.equal(privacy.sanitizeMetadata({ action: "resume" }).action, "resume");
    process.env.ANALYTICS_HASH_SECRET = "analytics-test-secret";
    const hashed = privacy.hashIdentifier("visitor-12345678");
    assert.ok(hashed);
    assert.notEqual(hashed, "visitor-12345678");
    assert.equal(privacy.hashIdentifier("visitor-12345678"), hashed);
  });

  test("relative change", () => {
    assert.equal(relativeChange(15, 10), 0.5);
    assert.equal(relativeChange(2, 0), null);
  });
});

const { loadEnvConfig } = require(path.join(projectRoot, "node_modules", "@next", "env"));
const { combinedEnv } = loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET || "fallback_secret";
if (!uri) {
  throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
}
process.env.MONGODB_URI = uri;
process.env.JWT_SECRET = jwtSecret;
process.env.ANALYTICS_HASH_SECRET = "analytics-test-secret";
process.env.ANALYTICS_RATE_LIMIT_PER_MINUTE = "60";

const mongoose = require(path.join(projectRoot, "node_modules", "mongoose"));
const jwt = require(path.join(projectRoot, "node_modules", "jsonwebtoken"));

describe("analytics pipeline", { concurrency: false }, () => {
  let User, StudentProfile, UserWebsiteConfig, VisitingCard, AnalyticsEvent;
  let configRoute, publishRoute, publicProfileRoute, cardRoute, cardPublishRoute, publicCardRoute;
  let eventsRoute, overviewRoute, resourcesRoute, detailRoute, timeseriesRoute, audienceRoute, sourcesRoute, eventListRoute, exportRoute;
  let resetAnalyticsRateLimits;
  let user1, user2, token1, token2, portfolioId, cardId, username;
  const createdUserIds = [];

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, "models", "User.ts")).default;
    StudentProfile = require(path.join(projectRoot, "models", "StudentProfile.ts")).default;
    UserWebsiteConfig = require(path.join(projectRoot, "models", "UserWebsiteConfig.ts")).default;
    VisitingCard = require(path.join(projectRoot, "models", "VisitingCard.ts")).default;
    AnalyticsEvent = require(path.join(projectRoot, "models", "AnalyticsEvent.ts")).default;
    configRoute = require(path.join(projectRoot, "app", "api", "student", "website", "config", "route.ts"));
    publishRoute = require(path.join(projectRoot, "app", "api", "student", "website", "publish", "route.ts"));
    publicProfileRoute = require(path.join(projectRoot, "app", "api", "public", "profile", "[username]", "route.ts"));
    cardRoute = require(path.join(projectRoot, "app", "api", "student", "card", "route.ts"));
    cardPublishRoute = require(path.join(projectRoot, "app", "api", "student", "card", "publish", "route.ts"));
    publicCardRoute = require(path.join(projectRoot, "app", "api", "public", "card", "[username]", "route.ts"));
    eventsRoute = require(path.join(projectRoot, "app", "api", "analytics", "events", "route.ts"));
    overviewRoute = require(path.join(projectRoot, "app", "api", "analytics", "overview", "route.ts"));
    resourcesRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "route.ts"));
    detailRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "route.ts"));
    timeseriesRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "timeseries", "route.ts"));
    audienceRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "audience", "route.ts"));
    sourcesRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "sources", "route.ts"));
    eventListRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "events", "route.ts"));
    exportRoute = require(path.join(projectRoot, "app", "api", "analytics", "resources", "[resourceId]", "export", "route.ts"));
    resetAnalyticsRateLimits = require(path.join(projectRoot, "lib", "analytics", "rate-limit.ts")).resetAnalyticsRateLimits;

    username = `an${Date.now()}`.toLowerCase();
    user1 = await User.create({ name: "Analytics Owner", email: `${username}@example.com`, password: "hashed_password", identity: "student", username });
    user2 = await User.create({ name: "Other Owner", email: `${username}_b@example.com`, password: "hashed_password", identity: "student", username: `${username}b` });
    createdUserIds.push(user1._id, user2._id);
    token1 = jwt.sign({ id: user1._id.toString(), email: user1.email }, jwtSecret);
    token2 = jwt.sign({ id: user2._id.toString(), email: user2.email }, jwtSecret);
    await StudentProfile.create({ userId: user1._id, preferredName: "Analytics Owner", headline: "Portfolio analytics" });

    const configRes = await configRoute.PUT(new Request("http://localhost:3000/api/student/website/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token1}`, "Content-Type": "application/json" },
      body: JSON.stringify({ username, selectedTemplateId: "magicui-portfolio" }),
    }));
    assert.equal(configRes.status, 200);
    const published = await publishRoute.POST(new Request("http://localhost:3000/api/student/website/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
    }));
    assert.equal(published.status, 200);
    const config = await UserWebsiteConfig.findOne({ userId: user1._id });
    portfolioId = config._id.toString();

    const publicProfile = await publicProfileRoute.GET(new Request("http://localhost/api/public/profile/" + username), { params: Promise.resolve({ username }) });
    assert.equal(publicProfile.status, 200);
    const publicProfileBody = await publicProfile.json();
    assert.equal(publicProfileBody.analytics.resourceId, portfolioId);
    assert.equal(publicProfileBody.analytics.resourceType, "portfolio");
    assert.equal(JSON.stringify(publicProfileBody).includes(user1._id.toString()), false);

    const createdCard = await cardRoute.POST(new Request("http://localhost:3000/api/student/card", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", templateId: "developer", designName: "Analytics Card" }),
    }));
    assert.equal(createdCard.status, 201);
    cardId = (await createdCard.json()).card._id;
    const publishedCard = await cardPublishRoute.POST(new Request("http://localhost:3000/api/student/card/publish", {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cardId }),
    }));
    assert.equal(publishedCard.status, 200);
    const publicCard = await publicCardRoute.GET(new Request("http://localhost/api/public/card/" + username), { params: Promise.resolve({ username }) });
    assert.equal(publicCard.status, 200);
    const publicCardBody = await publicCard.json();
    assert.equal(publicCardBody.card.analytics.resourceId, String(cardId));
    assert.equal(publicCardBody.card.analytics.resourceType, "visiting_card");
  });

  after(async () => {
    if (createdUserIds.length) {
      await AnalyticsEvent.deleteMany({ ownerId: { $in: createdUserIds } });
      await VisitingCard.deleteMany({ userId: { $in: createdUserIds } });
      await UserWebsiteConfig.deleteMany({ userId: { $in: createdUserIds } });
      await StudentProfile.deleteMany({ userId: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  });

  function eventRequest(body, headers) {
    return new Request("http://localhost:3000/api/analytics/events", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0", "x-forwarded-for": "203.0.113.40" }, headers || {}),
      body: JSON.stringify(body),
    });
  }

  test("ingests owned published events and rejects spoofed ownership", async () => {
    const shared = { sdkVersion: "1", resourceType: "portfolio", path: "/p/" + username, referrer: "https://news.example/story?token=secret" };
    const posts = [
      { eventId: "pageviewone0001", visitorId: "visitor-aaaaaaaa", sessionId: "session-aaaaaaaa", eventType: "page_view", resourceId: portfolioId },
      { eventId: "pageviewone0002", visitorId: "visitor-aaaaaaaa", sessionId: "session-aaaaaaaa", eventType: "page_view", resourceId: portfolioId },
      { eventId: "pageviewtwo0001", visitorId: "visitor-bbbbbbbb", sessionId: "session-bbbbbbbb", eventType: "page_view", resourceId: portfolioId },
      { eventId: "linkclick000001", visitorId: "visitor-aaaaaaaa", sessionId: "session-aaaaaaaa", eventType: "link_click", resourceId: portfolioId, metadata: { action: "outbound" } },
      { eventId: "download0000001", visitorId: "visitor-aaaaaaaa", sessionId: "session-aaaaaaaa", eventType: "download", resourceId: portfolioId, metadata: { action: "resume" }, utm: { source: "newsletter", medium: "email", campaign: "spring" } },
      { eventId: "campaignview001", visitorId: "visitor-cccccccc", sessionId: "session-cccccccc", eventType: "page_view", resourceId: portfolioId, utm: { source: "newsletter", medium: "email", campaign: "spring" } },
      { eventId: "cardview0000001", visitorId: "visitor-dddddddd", sessionId: "session-dddddddd", eventType: "page_view", resourceId: String(cardId), resourceType: "visiting_card", path: "/card/" + username },
    ];
    for (const body of posts) {
      const response = await eventsRoute.POST(eventRequest(Object.assign({}, shared, body)));
      assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    }

    const overview = await overviewRoute.GET(new Request("http://localhost/api/analytics/overview?type=portfolio&compare=false", { headers: { Authorization: `Bearer ${token1}` } }));
    assert.equal(overview.status, 200);
    const data = await overview.json();
    assert.equal(data.totals.pageViews, 4);
    assert.equal(data.totals.visitors, 3);
    assert.equal(data.totals.sessions, 3);
    assert.equal(data.totals.linkClicks, 1);
    assert.equal(data.totals.downloads, 1);
    assert.equal(data.totals.engagementRate, 0.3333);
    assert.equal(data.sources.campaigns[0].source, "newsletter");
    assert.equal(data.sources.campaigns[0].visits, 1);
    assert.equal(data.sources.campaigns[0].conversions, 1);
    assert.equal(data.sources.referrers[0].label, "news.example");
    assert.equal(data.audience.devices[0].label, "desktop");
    assert.equal(JSON.stringify(data).includes("visitor-aaaaaaaa"), false);

    const cardOverview = await overviewRoute.GET(new Request("http://localhost/api/analytics/overview?type=visiting_card&compare=false", { headers: { Authorization: `Bearer ${token1}` } }));
    const cardData = await cardOverview.json();
    assert.equal(cardData.totals.pageViews, 1);
    assert.equal(cardData.resources.some((resource) => resource.resourceType === "portfolio"), false);

    const duplicate = await eventsRoute.POST(eventRequest(Object.assign({}, shared, posts[0])));
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.duplicate, true);
    assert.equal(await AnalyticsEvent.countDocuments({ eventId: "pageviewone0001" }), 1);

    const spoofed = await eventsRoute.POST(eventRequest(Object.assign({}, shared, {
      eventId: "spoofedowner0001",
      eventType: "page_view",
      resourceId: portfolioId,
      visitorId: "visitor-eeeeeeee",
      sessionId: "session-eeeeeeee",
      ownerId: user2._id.toString(),
      occurredAt: "1999-01-01T00:00:00.000Z",
    })));
    assert.equal(spoofed.status, 202);
    const stored = await AnalyticsEvent.findOne({ eventId: "spoofedowner0001" }).lean();
    assert.equal(String(stored.ownerId), String(user1._id));
    assert.ok(new Date(stored.occurredAt).getUTCFullYear() >= 2026);
    assert.notEqual(stored.visitorId, "visitor-eeeeeeee");
  });

  test("filters abuse and unknown resources", async () => {
    const bot = await eventsRoute.POST(eventRequest({ sdkVersion: "1", eventId: "botfiltered0001", resourceId: portfolioId, resourceType: "portfolio", eventType: "page_view" }, { "user-agent": "Googlebot" }));
    assert.equal((await bot.json()).filtered, "bot");
    const prefetch = await eventsRoute.POST(eventRequest({ sdkVersion: "1", eventId: "prefetch0000001", resourceId: portfolioId, resourceType: "portfolio", eventType: "page_view" }, { purpose: "prefetch" }));
    assert.equal((await prefetch.json()).filtered, "prefetch");
    const broken = await eventsRoute.POST(new Request("http://localhost/api/analytics/events", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome" }, body: "{" }));
    assert.equal(broken.status, 400);
    const missing = await eventsRoute.POST(eventRequest({ sdkVersion: "1", eventId: "missingresource1", resourceId: new mongoose.Types.ObjectId().toString(), resourceType: "portfolio", eventType: "page_view" }));
    assert.equal(missing.status, 404);
    const huge = await eventsRoute.POST(eventRequest({ sdkVersion: "1", eventId: "hugepayload00001", resourceId: portfolioId, resourceType: "portfolio", eventType: "page_view", path: "x".repeat(9000) }));
    assert.equal(huge.status, 413);
    for (const eventId of ["botfiltered0001", "prefetch0000001", "missingresource1", "hugepayload00001"]) {
      assert.equal(await AnalyticsEvent.countDocuments({ eventId }), 0);
    }
    const noConsent = await eventsRoute.POST(eventRequest({ sdkVersion: "1", eventId: "noconsent0000001", resourceId: portfolioId, resourceType: "portfolio", eventType: "page_view", consent: false, visitorId: "visitor-ffffffff", sessionId: "session-ffffffff" }));
    assert.equal(noConsent.status, 202);
    const stored = await AnalyticsEvent.findOne({ eventId: "noconsent0000001" }).lean();
    assert.equal(stored.visitorId, null);
    assert.equal(stored.sessionId, null);
  });

  test("compares periods, buckets timezones, and serves owner reports", async () => {
    await AnalyticsEvent.create({
      eventId: "previousview0001",
      resourceId: portfolioId,
      ownerId: user1._id,
      resourceType: "portfolio",
      eventType: "page_view",
      occurredAt: new Date(Date.now() - 40 * 86400000),
      path: "/p/" + username,
      deviceCategory: "desktop",
      browserFamily: "Chrome",
      osFamily: "Windows",
      visitorId: "previousvisitorhash000000000001",
      sessionId: "previoussessionhash000000000001",
      metadata: {},
      ingestedAt: new Date(),
    });
    const detail = await detailRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}?compare=true`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) });
    const detailBody = await detail.json();
    assert.equal(detailBody.totals.previous.pageViews, 1);
    assert.ok(detailBody.totals.pageViews >= 1);

    await AnalyticsEvent.create({
      eventId: "kolkatabound001",
      resourceId: portfolioId,
      ownerId: user1._id,
      resourceType: "portfolio",
      eventType: "page_view",
      occurredAt: new Date("2025-12-31T18:30:00.000Z"),
      path: "/p/" + username,
      deviceCategory: "desktop",
      browserFamily: "Chrome",
      osFamily: "Windows",
      visitorId: "kolkatavisitorhash000000000001",
      sessionId: "kolkatasessionhash000000000001",
      metadata: {},
      ingestedAt: new Date(),
    });
    await AnalyticsEvent.create({
      eventId: "kolkatabound000",
      resourceId: portfolioId,
      ownerId: user1._id,
      resourceType: "portfolio",
      eventType: "page_view",
      occurredAt: new Date("2025-12-31T18:29:00.000Z"),
      path: "/p/" + username,
      deviceCategory: "desktop",
      browserFamily: "Chrome",
      osFamily: "Windows",
      visitorId: "kolkatavisitorhash000000000002",
      sessionId: "kolkatasessionhash000000000002",
      metadata: {},
      ingestedAt: new Date(),
    });
    const series = await timeseriesRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}/timeseries?from=2026-01-01&to=2026-01-01&timezone=Asia/Kolkata&compare=false`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) });
    const seriesBody = await series.json();
    assert.equal(seriesBody.timeseries.points.reduce((sum, point) => sum + point.pageViews, 0), 1);

    assert.equal((await audienceRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}/audience?compare=false`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) })).status, 200);
    assert.equal((await sourcesRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}/sources?compare=false`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) })).status, 200);
    const events = await eventListRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}/events?pageSize=2&compare=false`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) });
    const eventsBody = await events.json();
    assert.equal(eventsBody.events.length, 2);
    const exported = await exportRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}/export?format=csv&compare=false`, { headers: { Authorization: `Bearer ${token1}` } }), { params: Promise.resolve({ resourceId: portfolioId }) });
    assert.match(await exported.text(), /page_views/);
    const resources = await resourcesRoute.GET(new Request("http://localhost/api/analytics/resources?compare=false", { headers: { Authorization: `Bearer ${token1}` } }));
    const resourcesBody = await resources.json();
    assert.equal(resourcesBody.resources.some((resource) => resource.resourceId === portfolioId), true);
    assert.equal(resourcesBody.resources.some((resource) => resource.resourceId === String(cardId)), true);
  });

  test("requires authentication and hides other owners", async () => {
    const anonymous = await overviewRoute.GET(new Request("http://localhost/api/analytics/overview"));
    assert.equal(anonymous.status, 401);
    const foreign = await detailRoute.GET(new Request(`http://localhost/api/analytics/resources/${portfolioId}`, { headers: { Authorization: `Bearer ${token2}` } }), { params: Promise.resolve({ resourceId: portfolioId }) });
    assert.equal(foreign.status, 404);
    const otherOverview = await overviewRoute.GET(new Request("http://localhost/api/analytics/overview?compare=false", { headers: { Authorization: `Bearer ${token2}` } }));
    const otherBody = await otherOverview.json();
    assert.equal(otherBody.resources.length, 0);
    assert.equal(otherBody.totals.pageViews, 0);
  });

  test("rate limits the public collector without breaking public pages", async () => {
    process.env.ANALYTICS_RATE_LIMIT_PER_MINUTE = "3";
    resetAnalyticsRateLimits();
    let lastStatus = 0;
    for (let index = 0; index < 4; index += 1) {
      const response = await eventsRoute.POST(eventRequest({
        sdkVersion: "1",
        eventId: `ratelimit${index}00000001`.slice(0, 20),
        resourceId: new mongoose.Types.ObjectId().toString(),
        resourceType: "portfolio",
        eventType: "page_view",
      }, { "x-forwarded-for": "203.0.113.99" }));
      lastStatus = response.status;
    }
    assert.equal(lastStatus, 429);
    process.env.ANALYTICS_RATE_LIMIT_PER_MINUTE = "60";
    resetAnalyticsRateLimits();
    const profile = await publicProfileRoute.GET(new Request("http://localhost/api/public/profile/" + username), { params: Promise.resolve({ username }) });
    assert.equal(profile.status, 200);
  });
});
