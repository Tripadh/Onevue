import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchPublishedProfile } from "@/lib/onevue-api";
import { adaptOneVueProfile } from "@/lib/onevue-profile-adapter";
import { PortfolioClientWrapper } from "@/components/portfolio-client-wrapper";

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
  const result = await fetchPublishedProfile(username);

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
 * Guarantees:
 * - Fetches exclusively via server-side Phase 3 public API.
 * - Zero database access.
 * - Zero fallback to hardcoded demo profiles.
 * - Calls notFound() if unpublished, missing, or inactive.
 */
export default async function PublicProfilePage({
  params,
}: PublicProfilePageProps) {
  const { username } = await params;
  const result = await fetchPublishedProfile(username);

  if (!result.success || !result.data) {
    if (result.notFound) {
      notFound();
    }
    // For non-404 service failures, trigger Next.js error boundary or throw
    throw new Error(result.errorMessage || "Failed to load public portfolio.");
  }

  const { dto, website } = result.data;
  const adaptedData = adaptOneVueProfile(dto, website);

  return <PortfolioClientWrapper data={adaptedData} />;
}
