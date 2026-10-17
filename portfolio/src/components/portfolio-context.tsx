"use client";

import React, { createContext, useContext } from "react";
import { AdaptedPortfolioData } from "@/lib/onevue-profile-adapter";

const PortfolioContext = createContext<AdaptedPortfolioData | null>(null);

export function PortfolioProvider({
  data,
  children,
}: {
  data: AdaptedPortfolioData | null;
  children: React.ReactNode;
}) {
  return (
    <PortfolioContext.Provider value={data}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
