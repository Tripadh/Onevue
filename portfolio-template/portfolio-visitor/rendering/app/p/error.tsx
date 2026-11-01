"use client";

import { useEffect } from "react";
import BlurFade from "@/components/magicui/blur-fade";

/**
 * Error boundary for the public portfolio segment (/p/*).
 *
 * The route segment layout (src/app/p/[username]/layout.tsx) resolves the
 * published snapshot before the loading boundary flushes the response shell,
 * so an upstream service failure commits the HTTP 500 status. A segment error
 * boundary does not catch errors raised by its own segment's layout, so this
 * sibling boundary renders the designed retry experience for that path.
 */
export default function PublicPortfolioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log sanitized error summary in client console without leaking sensitive credentials
    console.error("Public portfolio loading failure:", error.message);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <BlurFade delay={0.04}>
        <div className="border bg-destructive/10 text-destructive z-10 rounded-full px-4 py-1.5 mb-6 inline-block">
          <span className="text-xs font-semibold uppercase tracking-wider">
            Service Unavailable
          </span>
        </div>
      </BlurFade>

      <BlurFade delay={0.08}>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
          Unable to Load Portfolio
        </h1>
      </BlurFade>

      <BlurFade delay={0.12}>
        <p className="max-w-md text-muted-foreground text-sm sm:text-base mb-8">
          We encountered a temporary connection issue while retrieving this published portfolio. Please try again shortly.
        </p>
      </BlurFade>

      <BlurFade delay={0.16}>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry Connection
        </button>
      </BlurFade>
    </div>
  );
}
