import type { Metadata } from "next";
import DraftPreviewClient from "./draft-preview-client";

export const metadata: Metadata = {
  title: "Draft preview",
  robots: { index: false, follow: false },
};

/**
 * Authenticated draft preview host.
 * The dashboard loads the saved profile and posts it here. This route never publishes.
 */
export default function DraftPreviewPage() {
  return <DraftPreviewClient />;
}
