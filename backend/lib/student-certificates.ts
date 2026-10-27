import { NextResponse } from "next/server";
import { verifyAuth } from "./auth";
import {
  callCertificateService,
  CertificateServiceError,
  parseCertificateSubmitBody,
  parseCertificateVerifyBody,
  readCertificateClientConfig,
  type CertificateServiceRecord,
} from "./certificate-client";
import { recordCertificateOnProfile } from "./certificate-profile";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable() {
  return NextResponse.json(
    { message: "Certificate verification is temporarily unavailable." },
    { status: 503 },
  );
}

function fromServiceError(error: CertificateServiceError) {
  return NextResponse.json({ message: error.message }, { status: error.status });
}

async function authenticatedUserId(req: Request): Promise<
  { userId: string } | { response: NextResponse }
> {
  const auth = await verifyAuth(req);
  if ("error" in auth) {
    return {
      response: NextResponse.json(
        { message: auth.error },
        { status: auth.status },
      ),
    };
  }
  return { userId: String(auth.user._id) };
}

async function withCertificate<T>(
  userId: string,
  work: () => Promise<{ status: number; certificate: CertificateServiceRecord; created?: boolean }>,
): Promise<NextResponse> {
  const config = readCertificateClientConfig();
  if (config === null) {
    return unavailable();
  }

  try {
    const result = await work();
    try {
      await recordCertificateOnProfile(userId, result.certificate);
    } catch {
      console.error("Could not link the certificate to the student profile.");
    }
    if (result.created === undefined) {
      return NextResponse.json(
        { certificate: result.certificate },
        { status: result.status },
      );
    }
    return NextResponse.json(
      { created: result.created, certificate: result.certificate },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof CertificateServiceError) {
      return fromServiceError(error);
    }
    return NextResponse.json(
      { message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}

export async function submitStudentCertificate(req: Request): Promise<NextResponse> {
  const auth = await authenticatedUserId(req);
  if ("response" in auth) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { message: "Request validation failed." },
      { status: 400 },
    );
  }

  let submission: { url: string };
  try {
    submission = parseCertificateSubmitBody(body);
  } catch (error) {
    if (error instanceof CertificateServiceError) {
      return fromServiceError(error);
    }
    throw error;
  }

  const config = readCertificateClientConfig();
  if (config === null) {
    return unavailable();
  }

  return withCertificate(auth.userId, () =>
    callCertificateService(
      config,
      auth.userId,
      "/certificates",
      "POST",
      submission,
    ),
  );
}

export async function readStudentCertificate(
  req: Request,
  certificateId: string,
): Promise<NextResponse> {
  const auth = await authenticatedUserId(req);
  if ("response" in auth) {
    return auth.response;
  }
  if (!UUID_PATTERN.test(certificateId)) {
    return NextResponse.json(
      { message: "Request validation failed." },
      { status: 400 },
    );
  }

  const config = readCertificateClientConfig();
  if (config === null) {
    return unavailable();
  }

  return withCertificate(auth.userId, () =>
    callCertificateService(
      config,
      auth.userId,
      `/certificates/${certificateId}`,
      "GET",
    ),
  );
}

export async function verifyStudentCertificate(
  req: Request,
  certificateId: string,
): Promise<NextResponse> {
  const auth = await authenticatedUserId(req);
  if ("response" in auth) {
    return auth.response;
  }
  if (!UUID_PATTERN.test(certificateId)) {
    return NextResponse.json(
      { message: "Request validation failed." },
      { status: 400 },
    );
  }

  const contentType = req.headers.get("content-type");
  if (
    contentType !== null &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return NextResponse.json(
      { message: "Content-Type must be application/json." },
      { status: 415 },
    );
  }

  const raw = await req.text();
  let submission: { earnerEmail?: string } = {};
  if (raw.trim().length > 0) {
    try {
      submission = parseCertificateVerifyBody(JSON.parse(raw));
    } catch (error) {
      if (error instanceof CertificateServiceError) {
        return fromServiceError(error);
      }
      return NextResponse.json(
        { message: "Request validation failed." },
        { status: 400 },
      );
    }
  }

  const config = readCertificateClientConfig();
  if (config === null) {
    return unavailable();
  }

  return withCertificate(auth.userId, () =>
    callCertificateService(
      config,
      auth.userId,
      `/certificates/${certificateId}/verify`,
      "POST",
      submission,
    ),
  );
}
