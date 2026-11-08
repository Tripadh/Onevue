import BlurFade from "@/components/magicui/blur-fade";
import BlurFadeText from "@/components/magicui/blur-fade-text";
import Link from "next/link";
import { ArrowUpRight, Globe, ShieldCheck } from "lucide-react";

const BLUR_FADE_DELAY = 0.04;

export default function Page() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-10 relative px-4 py-16 text-center">
      <div className="mx-auto w-full max-w-2xl space-y-8">
        <BlurFade delay={BLUR_FADE_DELAY}>
          <div className="border bg-primary/10 text-primary border-primary/20 z-10 rounded-full px-4 py-1.5 inline-flex items-center gap-2">
            <ShieldCheck className="size-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              OneVue Digital Identity & Portfolio Platform
            </span>
          </div>
        </BlurFade>

        <div className="space-y-4">
          <BlurFadeText
            delay={BLUR_FADE_DELAY * 2}
            className="text-4xl font-extrabold tracking-tighter sm:text-5xl lg:text-6xl text-foreground"
            yOffset={8}
            text="Verified Student Portfolios"
          />
          <BlurFadeText
            className="text-muted-foreground max-w-[600px] mx-auto md:text-lg lg:text-xl text-balance"
            delay={BLUR_FADE_DELAY * 3}
            text="Showcasing authentic student achievement, verified credentials, and real project experience."
          />
        </div>

        <BlurFade delay={BLUR_FADE_DELAY * 4}>
          <div className="border border-border/60 bg-card/60 backdrop-blur-sm rounded-2xl p-6 max-w-lg mx-auto text-left space-y-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-none">
                <Globe className="size-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Published Portfolios</h3>
                <p className="text-xs text-muted-foreground">
                  Individual student portfolios are accessible at their dedicated handle:
                </p>
              </div>
            </div>
            <div className="bg-muted/60 border border-border/40 rounded-xl px-4 py-2.5 font-mono text-sm text-foreground flex items-center justify-between">
              <span>onevue.me/p/<span className="text-primary font-semibold">:username</span></span>
            </div>
          </div>
        </BlurFade>

        <BlurFade delay={BLUR_FADE_DELAY * 5}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="https://onevue.me"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 text-sm font-medium shadow-md transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Go to OneVue Platform
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </BlurFade>
      </div>
    </main>
  );
}
