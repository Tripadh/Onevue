import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import { extractStudentResume } from "../../../../../lib/resume-extract";

/**
 * The LLM service stops an extraction at 60 seconds. The platform client
 * waits 70–90 seconds, and this route stays open long enough to return
 * that timeout instead of being cut off first.
 */
export const maxDuration = 120;

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const response = await extractStudentResume(req);
  return applyCorsHeaders(response, req.headers.get("origin"));
}
