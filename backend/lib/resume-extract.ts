import { Buffer } from "node:buffer";
import { verifyAuth } from "./auth";
import {
  LlmServiceError,
  readLlmClientConfig,
  requestLlmExtraction,
  type LlmClientConfig,
  type LlmExtractionResult,
} from "./llm-client";
import StudentProfile from "../models/StudentProfile";
import {
  createResumeReview,
  discardResumeReview,
  profileRevisionFrom,
  publicReview,
  readResumeReview,
  REVIEW_LOST_MESSAGE,
  REVIEW_TTL_MS,
} from "./resume-review";

const PDF_LIMIT_BYTES = 10 * 1024 * 1024;
const REQUEST_LIMIT_BYTES = PDF_LIMIT_BYTES + 1024 * 1024;
const PDF_MARK = "%PDF";

type ExtractDependencies = {
  extract?: typeof requestLlmExtraction;
  config?: LlmClientConfig | null;
  now?: () => number;
  ttlMs?: number;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function message(status: number, text: string): Response {
  return json({ message: text }, status);
}

async function userIdFrom(req: Request): Promise<{ userId: string } | { response: Response }> {
  const auth = await verifyAuth(req);
  if ("error" in auth) {
    return { response: message(auth.status, auth.error) };
  }
  if (String(auth.user.identity ?? "").trim().toLowerCase() !== "student") {
    return { response: message(403, "Resume extraction is available to student accounts.") };
  }
  return { userId: String(auth.user._id) };
}

export async function extractStudentResume(
  req: Request,
  dependencies: ExtractDependencies = {},
): Promise<Response> {
  const auth = await userIdFrom(req);
  if ("response" in auth) {
    return auth.response;
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_LIMIT_BYTES) {
    return message(413, "The PDF exceeds the 10 MB limit.");
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return message(415, "Content-Type must be multipart/form-data.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return message(400, "Request validation failed.");
  }

  const keys = [...form.keys()];
  if (keys.some((key) => key !== "file") || form.getAll("file").length !== 1) {
    return message(400, "Exactly one PDF file is required.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return message(400, "A PDF file is required.");
  }
  if (file.size === 0) {
    return message(400, "The uploaded PDF file is empty.");
  }
  if (file.size > PDF_LIMIT_BYTES) {
    return message(413, "The PDF exceeds the 10 MB limit.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return message(400, "The uploaded PDF file is empty.");
  }
  if (bytes.byteLength > PDF_LIMIT_BYTES) {
    return message(413, "The PDF exceeds the 10 MB limit.");
  }
  if (!hasPdfSignature(bytes)) {
    return message(400, "The file is not a PDF.");
  }

  const config = dependencies.config === undefined
    ? readLlmClientConfig()
    : dependencies.config;
  if (config === null) {
    return json({
      message: "Resume extraction is temporarily unavailable.",
      code: "unavailable",
    }, 503);
  }

  const extract = dependencies.extract ?? requestLlmExtraction;
  let extraction: LlmExtractionResult;
  try {
    extraction = await extract(
      {
        filename: "resume.pdf",
        bytes,
        mediaType: "application/pdf",
      },
      config,
    );
  } catch (error) {
    if (error instanceof LlmServiceError) {
      return json({ message: error.message, code: error.code }, error.status);
    }
    return json({
      message: "Resume extraction is temporarily unavailable.",
      code: "unavailable",
    }, 503);
  }

  const now = dependencies.now?.() ?? Date.now();
  const profile = await StudentProfile.findOne({ userId: auth.userId }).lean();
  const review = createResumeReview(
    auth.userId,
    extraction,
    now,
    dependencies.ttlMs ?? reviewTtl(),
    profileRevisionFrom(profile),
  );
  return json(publicReview(review), 200);
}

export async function readStudentResumeReview(
  req: Request,
  reviewId: string,
  now = Date.now(),
): Promise<Response> {
  const auth = await userIdFrom(req);
  if ("response" in auth) {
    return auth.response;
  }
  const review = readResumeReview(auth.userId, reviewId, now);
  if (review === null) {
    return message(404, REVIEW_LOST_MESSAGE);
  }
  return json(publicReview(review), 200);
}

export async function discardStudentResumeReview(
  req: Request,
  reviewId: string,
  now = Date.now(),
): Promise<Response> {
  const auth = await userIdFrom(req);
  if ("response" in auth) {
    return auth.response;
  }
  const discarded = discardResumeReview(auth.userId, reviewId, now);
  if (discarded === "busy") {
    return message(409, "This review is already being applied.");
  }
  if (discarded !== "discarded") {
    return message(404, REVIEW_LOST_MESSAGE);
  }
  return json({ discarded: true }, 200);
}

function reviewTtl(): number {
  const configured = Number(process.env.RESUME_REVIEW_TTL_MS ?? "");
  if (Number.isFinite(configured) && configured >= 1 && configured <= REVIEW_TTL_MS) {
    return configured;
  }
  return REVIEW_TTL_MS;
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("latin1");
  return head.includes(PDF_MARK);
}
