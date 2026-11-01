export default function ProfileLoading() {
  return (
    <main className="min-h-dvh flex flex-col gap-14 relative animate-pulse">
      {/* 1. Hero Skeleton */}
      <section id="hero-skeleton">
        <div className="mx-auto w-full max-w-2xl space-y-8">
          <div className="gap-2 gap-y-6 flex flex-col md:flex-row justify-between">
            <div className="gap-3 flex flex-col order-2 md:order-1 flex-1">
              {/* Name Skeleton */}
              <div className="h-10 w-64 bg-muted/70 rounded-xl" />
              {/* Headline Skeleton */}
              <div className="h-5 w-full max-w-[500px] bg-muted/50 rounded-lg" />
              <div className="h-5 w-3/4 max-w-[380px] bg-muted/40 rounded-lg" />
              {/* Location Skeleton */}
              <div className="h-4 w-32 bg-muted/40 rounded-md mt-1" />
            </div>
            {/* Avatar Skeleton */}
            <div className="order-1 md:order-2">
              <div className="size-24 md:size-32 rounded-full bg-muted/60 border ring-4 ring-muted" />
            </div>
          </div>
        </div>
      </section>

      {/* 2. About Skeleton */}
      <section id="about-skeleton">
        <div className="flex min-h-0 flex-col gap-y-4">
          <div className="h-6 w-20 bg-muted/70 rounded-md" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted/40 rounded-md" />
            <div className="h-4 w-11/12 bg-muted/40 rounded-md" />
            <div className="h-4 w-4/5 bg-muted/40 rounded-md" />
          </div>
        </div>
      </section>

      {/* 3. Education Skeleton */}
      <section id="education-skeleton">
        <div className="flex min-h-0 flex-col gap-y-6">
          <div className="h-6 w-28 bg-muted/70 rounded-md" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted/60" />
                <div className="space-y-1.5">
                  <div className="h-4 w-48 bg-muted/60 rounded-md" />
                  <div className="h-3 w-36 bg-muted/40 rounded-md" />
                </div>
              </div>
              <div className="h-3 w-20 bg-muted/40 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      {/* 4. Skills Skeleton */}
      <section id="skills-skeleton">
        <div className="flex min-h-0 flex-col gap-y-4">
          <div className="h-6 w-20 bg-muted/70 rounded-md" />
          <div className="flex flex-wrap gap-2">
            {[80, 100, 72, 96, 88, 110, 64].map((width, idx) => (
              <div
                key={idx}
                className="h-8 rounded-xl bg-muted/50 border border-border/40"
                style={{ width: `${width}px` }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 5. Projects Skeleton */}
      <section id="projects-skeleton">
        <div className="flex min-h-0 flex-col gap-y-6">
          <div className="h-6 w-28 bg-muted/70 rounded-md" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map((idx) => (
              <div
                key={idx}
                className="h-48 rounded-xl border border-border/40 bg-card/40 p-5 space-y-3"
              >
                <div className="h-5 w-3/4 bg-muted/60 rounded-md" />
                <div className="h-3 w-full bg-muted/40 rounded-md" />
                <div className="h-3 w-5/6 bg-muted/40 rounded-md" />
                <div className="flex gap-1.5 pt-4">
                  <div className="h-5 w-16 bg-muted/40 rounded" />
                  <div className="h-5 w-14 bg-muted/40 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
