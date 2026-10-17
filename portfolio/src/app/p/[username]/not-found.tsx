import Link from "next/link";
import BlurFade from "@/components/magicui/blur-fade";

export default function ProfileNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <BlurFade delay={0.04}>
        <div className="border bg-muted/40 z-10 rounded-full px-4 py-1.5 mb-6 inline-block">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            OneVue Portfolio
          </span>
        </div>
      </BlurFade>

      <BlurFade delay={0.08}>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl mb-4">
          Portfolio Not Available
        </h1>
      </BlurFade>

      <BlurFade delay={0.12}>
        <p className="max-w-md text-muted-foreground text-sm sm:text-base mb-8">
          This portfolio does not exist, is currently unpublished, or has been set to private by the student.
        </p>
      </BlurFade>

      <BlurFade delay={0.16}>
        <Link
          href="https://onevue.me"
          className="inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Return to OneVue
        </Link>
      </BlurFade>
    </div>
  );
}
