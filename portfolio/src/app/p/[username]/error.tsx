"use client";

import { useEffect } from "react";
import BlurFade from "@/components/magicui/blur-fade";

export default function ProfileError({
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
        <p className="max-w-md text-muted-foreground text-sm mb-8">
          We encountered a temporary connection issue while retrieving this published portfolio. Please try again shortly.
        </p>
      </BlurFade>

      <BlurFade delay={0.16}>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow transition-colors hover:bg-primary/90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry Connection
        </button>
      </BlurFade>
    </div>
  );
}
