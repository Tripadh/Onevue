-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING', 'VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('NOT_FOUND', 'FIELD_MISMATCH', 'ISSUER_UNAVAILABLE', 'MAX_ATTEMPTS');

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonical_url" TEXT,
    "issuer" TEXT,
    "credential_id" TEXT,
    "status" "CertificateStatus" NOT NULL,
    "evidence" JSONB,
    "submitted_at" TEXT NOT NULL,
    "verified_at" TEXT,
    "attempts" INTEGER NOT NULL,
    "failure_reason" "FailureReason",

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_user_id_url_key" ON "certificates"("user_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_user_credential_key" ON "certificates"("user_id", "issuer", "credential_id");
