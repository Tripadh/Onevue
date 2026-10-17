import { applyCorsHeaders, preflightResponse } from "../../../../../../lib/cors";
import {
  discardStudentResumeReview,
  readStudentResumeReview,
} from "../../../../../../lib/resume-extract";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(
  req: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await context.params;
  const response = await readStudentResumeReview(req, reviewId);
  return applyCorsHeaders(response, req.headers.get("origin"));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await context.params;
  const response = await discardStudentResumeReview(req, reviewId);
  return applyCorsHeaders(response, req.headers.get("origin"));
}
