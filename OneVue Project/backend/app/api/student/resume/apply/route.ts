import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import { applyStudentResume } from "../../../../../lib/resume-apply";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const response = await applyStudentResume(req);
  return applyCorsHeaders(response, req.headers.get("origin"));
}
