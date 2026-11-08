import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getPublishedProfile } from "@/lib/onevue-profile-route";
import { resolveVisitorTemplateRelease } from "@/lib/template-visitor-release";

interface PublicProfileLayoutProps {
  children: ReactNode;
  params: Promise<{
    username: string;
  }>;
}

/**
 * Segment layout for the public portfolio route (/p/:username).
 *
 * Resolves the published profile snapshot BEFORE the segment's loading.tsx
 * Suspense boundary flushes its response shell. A not-found profile therefore
 * commits the HTTP 404 status before any bytes are written, instead of
 * returning HTTP 200 with a not-found body.
 *
 * Upstream service failures are raised here as well, so that the HTTP 500
 * status is committed before the shell is flushed. A segment error boundary
 * does not catch errors raised by its own segment's layout, so the sibling
 * /p/error.tsx boundary renders the designed retry experience for this path.
 *
 * Phase 5.13 — the published template release is resolved through the backend
 * artifact storage and validated (manifest structure, self-checksum and the
 * entrypoint SHA-256) here for the same reason: a missing artifact, an
 * invalid manifest or a failed integrity check must commit the HTTP 500
 * status BEFORE the shell is flushed. A failure raised only in the page
 * would render the error experience but still return HTTP 200.
 */
export default async function PublicProfileLayout({
  children,
  params,
}: PublicProfileLayoutProps) {
  const { username } = await params;
  const result = await getPublishedProfile(username);

  if (!result.success || !result.data) {
    if (result.notFound) {
      notFound();
    }
    // Non-404 upstream failures are transient service errors. They are raised
    // before the response shell is flushed so the HTTP 500 status is set.
    throw new Error(result.errorMessage || "Failed to load public portfolio.");
  }

  const { website } = result.data;

  // Resolve and validate the immutable release from the backend artifact
  // storage. The template identity and version come from the published
  // revision, so the release that is validated is exactly the release that
  // is rendered. Another template or release is never substituted.
  const releaseResolution = await resolveVisitorTemplateRelease(
    website.templateId,
    website.templateVersion
  );

  if (!releaseResolution.ok) {
    throw new Error(
      releaseResolution.resolution.error ||
        "The published template release could not be resolved from artifact storage."
    );
  }

  return <>{children}</>;
}
