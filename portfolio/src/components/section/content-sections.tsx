"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import type {
  AdaptedCredential,
  AdaptedHighlight,
  AdaptedMediaItem,
  AdaptedTeamMember,
  AdaptedTestimonial,
} from "@/lib/onevue-profile-adapter";
import { StoredText } from "@/components/section/stored-text";

function SectionHeading({ children }: { children: string }) {
  return <h2 className="text-xl font-bold">{children}</h2>;
}

export function CredentialsSection({ credentials }: { credentials: AdaptedCredential[] }) {
  if (credentials.length === 0) return null;
  return (
    <section id="credentials">
      <div className="flex min-h-0 flex-col gap-y-4">
        <SectionHeading>Credentials</SectionHeading>
        <div className="flex flex-col gap-4">
          {credentials.map((item, index) => (
            <div key={item.title + index} className="flex flex-col gap-1">
              <div className="font-semibold leading-none">{item.title}</div>
              {(item.issuer || item.date) && (
                <div className="text-sm text-muted-foreground">
                  {[item.issuer, item.date].filter(Boolean).join(" · ")}
                </div>
              )}
              {item.description ? <StoredText text={item.description} /> : null}
              {item.href !== "#" && (
                <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                  View credential
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HighlightsSection({ highlights }: { highlights: AdaptedHighlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <section id="highlights">
      <div className="flex min-h-0 flex-col gap-y-4">
        <SectionHeading>Achievements</SectionHeading>
        <div className="flex flex-col gap-4">
          {highlights.map((item, index) => (
            <div key={item.title + index} className="flex flex-col gap-1">
              <div className="font-semibold leading-none">{item.title}</div>
              {item.date && <div className="text-sm text-muted-foreground">{item.date}</div>}
              {item.description ? <StoredText text={item.description} /> : null}
              {item.href !== "#" && (
                <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                  View details
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TestimonialsSection({ testimonials }: { testimonials: AdaptedTestimonial[] }) {
  if (testimonials.length === 0) return null;
  return (
    <section id="testimonials">
      <div className="flex min-h-0 flex-col gap-y-4">
        <SectionHeading>Testimonials</SectionHeading>
        <div className="flex flex-col gap-4">
          {testimonials.map((item, index) => (
            <blockquote key={item.author + index} className="flex flex-col gap-1">
              <StoredText text={item.quote} />
              {(item.author || item.relationship) && (
                <footer className="text-sm font-medium">
                  {[item.author, item.relationship].filter(Boolean).join(" · ")}
                </footer>
              )}
              {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TeamSection({ team }: { team: AdaptedTeamMember[] }) {
  if (team.length === 0) return null;
  return (
    <section id="team">
      <div className="flex min-h-0 flex-col gap-y-4">
        <SectionHeading>Team</SectionHeading>
        <div className="flex flex-col gap-3">
          {team.map((member, index) => (
            <div key={member.name + index}>
              <div className="font-semibold leading-none">{member.name}</div>
              {member.role && <div className="text-sm text-muted-foreground">{member.role}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MediaImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-48 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function MediaSection({ media }: { media: AdaptedMediaItem[] }) {
  if (media.length === 0) return null;
  return (
    <section id="media">
      <div className="flex min-h-0 flex-col gap-y-4">
        <SectionHeading>Media</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {media.map((item, index) => {
            const isImage = item.mediaType === "image" || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(item.href);
            return (
              <a
                key={item.href + index}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="overflow-hidden rounded-xl border border-border/60"
              >
                {isImage ? <MediaImage src={item.href} alt={item.alt || item.title} /> : null}
                <div className="px-3 py-2 text-sm font-medium">{item.title}</div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
