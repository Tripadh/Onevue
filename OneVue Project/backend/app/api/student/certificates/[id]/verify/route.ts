import { applyCorsHeaders, preflightResponse } from "../../../../../../lib/cors";
import { verifyStudentCertificate } from "../../../../../../lib/student-certificates";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const response = await verifyStudentCertificate(req, id);
  return applyCorsHeaders(response, req.headers.get("origin"));
}
