"use client";

import React from "react";
import { AdaptedPortfolioData } from "@/lib/onevue-profile-adapter";
import { PortfolioProvider } from "@/components/portfolio-context";
import PortfolioView from "@/components/portfolio-view";
import { PortfolioAnalytics } from "@/components/portfolio-analytics";

export function PortfolioClientWrapper({
  data,
  analytics,
}: {
  data: AdaptedPortfolioData;
  analytics?: { resourceId: string; endpoint: string; path: string } | null;
}) {
  return (
    <PortfolioProvider data={data}>
      {analytics?.resourceId ? <PortfolioAnalytics {...analytics} /> : null}
      <PortfolioView data={data} />
    </PortfolioProvider>
  );
}
