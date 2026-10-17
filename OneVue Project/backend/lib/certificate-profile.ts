import connectToDatabase from "./db";
import StudentProfile from "../models/StudentProfile";
import type { CertificateServiceStatus } from "./certificate-client";

export function profileStatusForCertificate(
  status: CertificateServiceStatus,
  recipientMatch: "unchecked" | "matched" | "mismatched" = "unchecked",
): "pending" | "verified" | "rejected" {
  if (status === "UNVERIFIED") {
    return "rejected";
  }
  if (status === "VERIFIED" && recipientMatch === "matched") {
    return "verified";
  }
  return "pending";
}

export async function recordCertificateOnProfile(
  userId: string,
  certificate: {
    id: string;
    url: string;
    status: CertificateServiceStatus;
    recipientMatch?: "unchecked" | "matched" | "mismatched";
  },
): Promise<void> {
  await connectToDatabase();
  const profile = await StudentProfile.findOne({ userId });
  if (!profile || !Array.isArray(profile.credentials)) {
    return;
  }

  let changed = false;
  for (const credential of profile.credentials) {
    const verificationUrl = String(credential.verificationUrl || "").trim();
    const credentialUrl = String(credential.credentialUrl || "").trim();
    const linkedId = String(credential.certificateVerificationId || "");
    const matchesSavedUrl =
      verificationUrl === certificate.url ||
      (verificationUrl.length === 0 && credentialUrl === certificate.url);
    if (!matchesSavedUrl && linkedId !== certificate.id) {
      continue;
    }
    credential.certificateVerificationId = certificate.id;
    credential.verificationStatus = profileStatusForCertificate(
      certificate.status,
      "recipientMatch" in certificate ? certificate.recipientMatch : "unchecked",
    );
    credential.verificationMethod = "certificate-service";
    changed = true;
  }

  if (changed) {
    await profile.save();
  }
}
