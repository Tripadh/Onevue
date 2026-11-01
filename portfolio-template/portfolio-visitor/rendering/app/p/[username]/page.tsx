import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedProfile } from "@/lib/onevue-profile-route";
import { resolveVisitorEntrypoint } from "@/lib/template-visitor-release";
import { renderPublicTemplateHtml } from "@/lib/template-renderer";

interface PublicProfilePageProps {
  params: Promise<{
    username: string;
  }>;
}

/**
 * Dynamic metadata generation for public OneVue portfolio profiles.
 * Strictly consumes the public DTO active snapshot.
 */
export async function generateMetadata({
  params,
}: PublicProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  const result = await getPublishedProfile(username);

  if (!result.success || !result.data) {
    return {
      title: "Profile Not Found",
      description: "The requested OneVue portfolio profile was not found or is unpublished.",
    };
  }

  const { dto, website } = result.data;
  const displayName = dto.profile.displayName || website.username || "Student";
  const headline = dto.profile.headline || `${displayName}'s personal portfolio`;
  const canonicalUrl = dto.meta.canonicalUrl || `https://onevue.me/p/${website.username}`;

  return {
    title: `${displayName} | Portfolio`,
    description: headline,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${displayName} | OneVue Portfolio`,
      description: headline,
      url: canonicalUrl,
      siteName: `${displayName}'s Portfolio`,
      type: "profile",
      images: dto.profile.profilePhoto
        ? [
            {
              url: dto.profile.profilePhoto,
              alt: displayName,
            },
          ]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} | OneVue Portfolio`,
      description: headline,
      images: dto.profile.profilePhoto ? [dto.profile.profilePhoto] : [],
    },
  };
}

/**
 * Server-rendered Public Portfolio Page (/p/:username).
 * OneVue Phase 2.4.4 — Serves local versioned public template artifact:
 * - Strictly consumes the immutable published revision from OneVue Phase 3 API.
 * - Resolves template release and verifies against Central Registry.
 * - Enforces path traversal barriers.
 * - Verifies presence of production HTML entrypoint on disk (never silently falls back).
 * - Safely serializes PublicProfileDTO and escapes '<' as '\u003c'.
 * - Injects payload into __ONEVUE_DTO__ script placeholder.
 * - Serves versioned assets from /templates/<templateId>/<version>/assets/.
 * - Preserves SEO metadata, 404, and 500 behavior.
 */
export default async function PublicProfilePage({
  params,
}: PublicProfilePageProps) {
  const { username } = await params;
  const result = await getPublishedProfile(username);

  if (!result.success || !result.data) {
    if (result.notFound) {
      notFound();
    }
    // For non-404 service failures, trigger Next.js error boundary or throw
    throw new Error(result.errorMessage || "Failed to load public portfolio.");
  }

  const { dto, website } = result.data;

  // Phase 5.14 — the entrypoint document is delivered by the backend artifact
  // delivery boundary: the bytes rendered here are the bytes the backend
  // stored, validated against the release manifest and re-verified by SHA-256.
  // The template identity and version come from the published revision, so the
  // exact release that was published is the one that is rendered. Another
  // template or release is never substituted.
  const entrypoint = await resolveVisitorEntrypoint(
    website.templateId,
    website.templateVersion
  );

  if (!entrypoint.ok || !entrypoint.html) {
    throw new Error(
      entrypoint.resolution.error ||
        "The published template artifact could not be delivered."
    );
  }

  const renderedHtml = renderPublicTemplateHtml({
    dto,
    website,
    entrypointHtml: entrypoint.html,
  });

  const displayName = dto.profile.displayName || website.username || "Student";

  return (
    <iframe
      srcDoc={renderedHtml}
      title={`${displayName}'s Portfolio`}
      className="fixed inset-0 w-full h-full border-0 z-50 bg-background"
    />
  );
}

export { renderPublicTemplateHtml };
