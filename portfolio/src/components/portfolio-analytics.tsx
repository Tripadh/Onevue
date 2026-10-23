"use client";

import { useEffect } from "react";
import { createPortfolioTracker } from "@/lib/onevue-analytics";

export function PortfolioAnalytics({
  resourceId,
  endpoint,
  path,
}: {
  resourceId: string;
  endpoint: string;
  path: string;
}) {
  useEffect(() => {
    try {
      return createPortfolioTracker({ resourceId, endpoint, path }).start();
    } catch {
      return undefined;
    }
  }, [resourceId, endpoint, path]);

  return null;
}
