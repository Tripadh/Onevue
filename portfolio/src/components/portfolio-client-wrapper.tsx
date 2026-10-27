"use client";

import React, { useEffect } from "react";
import { useTheme } from "next-themes";
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
  const { setTheme } = useTheme();
  useEffect(() => {
    if (data.themeMode === "light" || data.themeMode === "dark" || data.themeMode === "system") {
      setTheme(data.themeMode);
    }
  }, [data.themeMode, setTheme]);

  return (
    <PortfolioProvider data={data}>
      {analytics?.resourceId ? <PortfolioAnalytics {...analytics} /> : null}
      <PortfolioView data={data} />
    </PortfolioProvider>
  );
}
