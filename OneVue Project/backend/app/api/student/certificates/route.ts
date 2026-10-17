import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import { submitStudentCertificate } from "../../../../lib/student-certificates";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const response = await submitStudentCertificate(req);
  return applyCorsHeaders(response, req.headers.get("origin"));
}
