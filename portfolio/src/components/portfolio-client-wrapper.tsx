"use client";

import React from "react";
import { AdaptedPortfolioData } from "@/lib/onevue-profile-adapter";
import { PortfolioProvider } from "@/components/portfolio-context";
import PortfolioView from "@/components/portfolio-view";

export function PortfolioClientWrapper({ data }: { data: AdaptedPortfolioData }) {
  return (
    <PortfolioProvider data={data}>
      <PortfolioView data={data} />
    </PortfolioProvider>
  );
}
