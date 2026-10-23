import { buildAnalyticsReport } from "./aggregate";
import { AnalyticsRange } from "./dates";
import { AnalyticsGate, authorizeResource, readRange } from "./http";
import { AnalyticsResourceRecord } from "./resources";

export async function loadOwnedReport(
  req: Request,
  resourceId: string
): Promise<AnalyticsGate<{ resource: AnalyticsResourceRecord; range: AnalyticsRange; report: Awaited<ReturnType<typeof buildAnalyticsReport>> }>> {
  const auth = await authorizeResource(req, resourceId);
  if (!auth.ok) return auth;
  const parsed = readRange(req);
  if (!parsed.ok) return parsed;
  const report = await buildAnalyticsReport(String(auth.user._id), [auth.resource], parsed.range);
  return { ok: true, resource: auth.resource, range: parsed.range, report };
}
