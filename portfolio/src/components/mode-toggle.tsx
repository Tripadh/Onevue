"use client";

import { useTheme } from "next-themes";
import { MoonStar, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? (resolvedTheme === "dark" || theme === "dark") : true;

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      className={cn(
        "size-full flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground transition-colors outline-none",
        className
      )}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? (
        <MoonStar className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
    </button>
  );
}
