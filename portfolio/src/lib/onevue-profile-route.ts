/**
 * Request-scoped, deduplicated public profile lookup for the /p/:username route.
 *
 * Wraps fetchPublishedProfile in React's cache() so the route layout and the
 * route page share a single upstream request per HTTP request instead of
 * issuing one lookup each.
 */

import { cache } from "react";
import { fetchPublishedProfile, type FetchPublicProfileResult } from "./onevue-api";

export const getPublishedProfile = cache(
  async (username: string): Promise<FetchPublicProfileResult> => fetchPublishedProfile(username)
);
