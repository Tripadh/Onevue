import { NextResponse } from "next/server";
import connectToDatabase from "../db";
import { verifyAuth } from "../auth";
import { AnalyticsQueryError, AnalyticsRange, parseAnalyticsRange } from "./dates";
import { AnalyticsResourceRecord, findOwnedResource } from "./resources";

export function analyticsJson(body: Record<string, unknown>, status = 200, headers?: Record<string, string>) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  if (headers) {
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  }
  return response;
}

export type AnalyticsGate<T> = { ok: false; response: NextResponse } | ({ ok: true } & T);

export async function authenticateAnalytics(req: Request): Promise<AnalyticsGate<{ user: { _id: unknown } }>> {
  const auth = await verifyAuth(req);
  if ("error" in auth) {
    return {
      ok: false,
      response: analyticsJson({ success: false, message: auth.error, code: "unauthorized" }, auth.status),
    };
  }
  await connectToDatabase();
  return { ok: true, user: auth.user };
}

export async function authorizeResource(
  req: Request,
  resourceId: string
): Promise<AnalyticsGate<{ user: { _id: unknown }; resource: AnalyticsResourceRecord }>> {
  const auth = await authenticateAnalytics(req);
  if (!auth.ok) return auth;
  const resource = await findOwnedResource(auth.user._id, resourceId);
  if (!resource) {
    return {
      ok: false,
      response: analyticsJson({ success: false, message: "Analytics resource not found.", code: "not_found" }, 404),
    };
  }
  return { ok: true, user: auth.user, resource };
}

export function readRange(req: Request, now = new Date()): AnalyticsGate<{ range: AnalyticsRange }> {
  try {
    return { ok: true, range: parseAnalyticsRange(new URL(req.url).searchParams, now) };
  } catch (error) {
    if (error instanceof AnalyticsQueryError) {
      return {
        ok: false,
        response: analyticsJson({ success: false, message: error.message, code: error.code }, error.status),
      };
    }
    throw error;
  }
}

export function rangePayload(range: AnalyticsRange) {
  return {
    from: range.from,
    to: range.to,
    timezone: range.timezone,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    compare: range.compare,
    granularity: range.granularity,
  };
}
