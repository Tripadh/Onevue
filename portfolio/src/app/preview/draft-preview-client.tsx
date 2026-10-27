"use client";

import { useEffect, useState } from "react";
import { PortfolioClientWrapper } from "@/components/portfolio-client-wrapper";
import { adaptDraftPreview, DRAFT_PREVIEW_READY } from "@/lib/draft-preview";
import type { AdaptedPortfolioData } from "@/lib/onevue-profile-adapter";

export default function DraftPreviewClient() {
  const [data, setData] = useState<AdaptedPortfolioData | null>(null);
  const [message, setMessage] = useState("Waiting for the saved draft…");

  useEffect(() => {
    const parentOrigin = (() => {
      try {
        return document.referrer ? new URL(document.referrer).origin : "";
      } catch {
        return "";
      }
    })();

    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const result = adaptDraftPreview(event.data, event.origin);
      if ("error" in result) {
        setData(null);
        setMessage(result.error);
        return;
      }
      setData(result.data);
      setMessage("");
    }

    window.addEventListener("message", onMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ type: DRAFT_PREVIEW_READY }, parentOrigin || "*");
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!data) {
    return <p className="text-sm text-muted-foreground">{message}</p>;
  }

  return <PortfolioClientWrapper data={data} />;
}
