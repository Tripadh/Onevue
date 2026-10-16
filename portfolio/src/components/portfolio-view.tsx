/* eslint-disable @next/next/no-img-element */
import BlurFade from "@/components/magicui/blur-fade";
import BlurFadeText from "@/components/magicui/blur-fade-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import Markdown from "react-markdown";
import ContactSection from "@/components/section/contact-section";
import HackathonsSection from "@/components/section/hackathons-section";
import ProjectsSection from "@/components/section/projects-section";
import WorkSection from "@/components/section/work-section";
import { ArrowUpRight, Code2 } from "lucide-react";
import { AdaptedPortfolioData } from "@/lib/onevue-profile-adapter";
import { ReactLight } from "@/components/ui/svgs/reactLight";
import { NextjsIconDark } from "@/components/ui/svgs/nextjsIconDark";
import { Typescript } from "@/components/ui/svgs/typescript";
import { Nodejs } from "@/components/ui/svgs/nodejs";
import { Python } from "@/components/ui/svgs/python";
import { Golang } from "@/components/ui/svgs/golang";
import { Postgresql } from "@/components/ui/svgs/postgresql";
import { Docker } from "@/components/ui/svgs/docker";
import { Kubernetes } from "@/components/ui/svgs/kubernetes";
import { Java } from "@/components/ui/svgs/java";
import { Csharp } from "@/components/ui/svgs/csharp";

const BLUR_FADE_DELAY = 0.04;

function getSkillIcon(name: string) {
  const n = name.toLowerCase().replace(/[\s.-]/g, "");
  if (n === "react" || n === "reactjs") return ReactLight;
  if (n === "next" || n === "nextjs") return NextjsIconDark;
  if (n === "typescript" || n === "ts") return Typescript;
  if (n === "nodejs" || n === "node") return Nodejs;
  if (n === "python") return Python;
  if (n === "go" || n === "golang") return Golang;
  if (n === "postgres" || n === "postgresql") return Postgresql;
  if (n === "docker") return Docker;
  if (n === "kubernetes" || n === "k8s") return Kubernetes;
  if (n === "java") return Java;
  if (n === "c++" || n === "cpp" || n === "csharp" || n === "c#") return Csharp;
  return null;
}

interface PortfolioViewProps {
  data: AdaptedPortfolioData;
}

export default function PortfolioView({ data }: PortfolioViewProps) {
  const { visibleSections } = data;

  return (
    <main className="min-h-dvh flex flex-col gap-14 relative">
      {/* 1. Hero Section */}
      {visibleSections.hero && (
        <section id="hero">
          <div className="mx-auto w-full max-w-2xl space-y-8">
            <div className="gap-2 gap-y-6 flex flex-col md:flex-row justify-between">
              <div className="gap-2 flex flex-col order-2 md:order-1">
                <BlurFadeText
                  delay={BLUR_FADE_DELAY}
                  className="text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl"
                  yOffset={8}
                  text={`Hi, I'm ${data.name}`}
                />
                {data.description && (
                  <BlurFadeText
                    className="text-muted-foreground max-w-[600px] md:text-lg lg:text-xl"
                    delay={BLUR_FADE_DELAY}
                    text={data.description}
                  />
                )}
                {data.location && (
                  <BlurFade delay={BLUR_FADE_DELAY * 2}>
                    <p className="text-xs text-muted-foreground">{data.location}</p>
                  </BlurFade>
                )}
              </div>
              <BlurFade delay={BLUR_FADE_DELAY} className="order-1 md:order-2">
                <Avatar className="size-24 md:size-32 border rounded-full shadow-lg ring-4 ring-muted">
                  {data.avatarUrl && <AvatarImage alt={data.name} src={data.avatarUrl} />}
                  <AvatarFallback className="text-xl font-bold">{data.initials}</AvatarFallback>
                </Avatar>
              </BlurFade>
            </div>
          </div>
        </section>
      )}

      {/* 2. About Section */}
      {visibleSections.about && data.summary && (
        <section id="about">
          <div className="flex min-h-0 flex-col gap-y-4">
            <BlurFade delay={BLUR_FADE_DELAY * 3}>
              <h2 className="text-xl font-bold">About</h2>
            </BlurFade>
            <BlurFade delay={BLUR_FADE_DELAY * 4}>
              <div className="prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert">
                <Markdown>{data.summary}</Markdown>
              </div>
            </BlurFade>
          </div>
        </section>
      )}

      {/* 3. Work Section (Only rendered if genuine internship/experience exists) */}
      {visibleSections.work && data.work.length > 0 && (
        <section id="work">
          <div className="flex min-h-0 flex-col gap-y-6">
            <BlurFade delay={BLUR_FADE_DELAY * 5}>
              <h2 className="text-xl font-bold">Experience</h2>
            </BlurFade>
            <BlurFade delay={BLUR_FADE_DELAY * 6}>
              <WorkSection work={data.work} />
            </BlurFade>
          </div>
        </section>
      )}

      {/* 4. Education Section */}
      {visibleSections.education && data.education.length > 0 && (
        <section id="education">
          <div className="flex min-h-0 flex-col gap-y-6">
            <BlurFade delay={BLUR_FADE_DELAY * 7}>
              <h2 className="text-xl font-bold">Education</h2>
            </BlurFade>
            <div className="flex flex-col gap-8">
              {data.education.map((education, index) => (
                <BlurFade
                  key={education.school + index}
                  delay={BLUR_FADE_DELAY * 8 + index * 0.05}
                >
                  <Link
                    href={education.href}
                    target={education.href !== "#" ? "_blank" : undefined}
                    rel={education.href !== "#" ? "noopener noreferrer" : undefined}
                    className="flex items-center gap-x-3 justify-between group"
                  >
                    <div className="flex items-center gap-x-3 flex-1 min-w-0">
                      {education.logoUrl ? (
                        <img
                          src={education.logoUrl}
                          alt={education.school}
                          className="size-8 md:size-10 p-1 border rounded-full shadow ring-2 ring-border overflow-hidden object-contain flex-none"
                        />
                      ) : (
                        <div className="size-8 md:size-10 p-1 border rounded-full shadow ring-2 ring-border bg-muted flex-none flex items-center justify-center text-xs font-semibold">
                          {education.school.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="font-semibold leading-none flex items-center gap-2">
                          {education.school}
                          {education.href !== "#" && (
                            <ArrowUpRight
                              className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
                              aria-hidden
                            />
                          )}
                        </div>
                        <div className="font-sans text-sm text-muted-foreground">
                          {education.degree}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground text-right flex-none">
                      <span>
                        {education.start} - {education.end}
                      </span>
                    </div>
                  </Link>
                </BlurFade>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 5. Skills Section */}
      {visibleSections.skills && data.skills.length > 0 && (
        <section id="skills">
          <div className="flex min-h-0 flex-col gap-y-4">
            <BlurFade delay={BLUR_FADE_DELAY * 9}>
              <h2 className="text-xl font-bold">Skills</h2>
            </BlurFade>
            <div className="flex flex-wrap gap-2">
              {data.skills.map((skill, id) => {
                const IconComp = getSkillIcon(skill.name);
                return (
                  <BlurFade key={skill.name + id} delay={BLUR_FADE_DELAY * 10 + id * 0.05}>
                    <div className="border bg-background border-border ring-2 ring-border/20 rounded-xl h-8 w-fit px-4 flex items-center gap-2">
                      {IconComp ? (
                        <IconComp className="size-4 rounded overflow-hidden object-contain" />
                      ) : (
                        <Code2 className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="text-foreground text-sm font-medium">{skill.name}</span>
                    </div>
                  </BlurFade>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 6. Projects Section */}
      {visibleSections.projects && data.projects.length > 0 && (
        <section id="projects">
          <BlurFade delay={BLUR_FADE_DELAY * 11}>
            <ProjectsSection projects={data.projects} />
          </BlurFade>
        </section>
      )}

      {/* 7. Hackathons Section */}
      {visibleSections.hackathons && data.hackathons.length > 0 && (
        <section id="hackathons">
          <BlurFade delay={BLUR_FADE_DELAY * 13}>
            <HackathonsSection hackathons={data.hackathons} />
          </BlurFade>
        </section>
      )}

      {/* 8. Contact Section */}
      {visibleSections.contact && (
        <section id="contact">
          <BlurFade delay={BLUR_FADE_DELAY * 16}>
            <ContactSection contact={data.contact} />
          </BlurFade>
        </section>
      )}
    </main>
  );
}
