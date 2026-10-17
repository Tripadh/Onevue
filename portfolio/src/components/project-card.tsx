/* eslint-disable @next/next/no-img-element */
"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Globe, Github, Video, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import Markdown from "react-markdown";

function renderLinkIcon(link: { icon?: React.ReactNode; iconName?: string }) {
  if (link.icon) return link.icon;
  if (link.iconName === "github") return <Github className="size-3" />;
  if (link.iconName === "video") return <Video className="size-3" />;
  if (link.iconName === "doc") return <FileText className="size-3" />;
  return <Globe className="size-3" />;
}

function ProjectImage({ src, alt }: { src: string; alt: string }) {
  const [imageError, setImageError] = useState(false);

  if (!src || imageError) {
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-48 object-cover"
      onError={() => setImageError(true)}
    />
  );
}

interface Props {
  title: string;
  href?: string;
  description: string;
  dates: string;
  tags: readonly string[];
  link?: string;
  image?: string;
  video?: string;
  links?: readonly {
    icon?: React.ReactNode;
    iconName?: string;
    type: string;
    href: string;
  }[];
  className?: string;
}

export function ProjectCard({
  title,
  href,
  description,
  dates,
  tags,
  link,
  image,
  video,
  links,
  className,
}: Props) {
  const hasMedia = Boolean(video || (image && image.trim().length > 0));

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border/60 bg-card/60 dark:bg-card/40 rounded-xl overflow-hidden hover:border-border hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5",
        className
      )}
    >
      {/* 1. Optional Media Header (Only rendered when video or image actually exists) */}
      {hasMedia && (
        <div className="relative shrink-0 overflow-hidden border-b border-border/40">
          <Link
            href={href || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            {video ? (
              <video
                src={video}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-48 object-cover"
              />
            ) : (
              <ProjectImage src={image!} alt={title} />
            )}
          </Link>
          {links && links.length > 0 && (
            <div className="absolute top-2 right-2 flex flex-wrap gap-1.5">
              {links.map((lnk, idx) => (
                <Link
                  href={lnk.href}
                  key={idx}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge
                    className="flex items-center gap-1.5 text-xs bg-black/80 backdrop-blur-md text-white hover:bg-black transition-colors"
                    variant="default"
                  >
                    {renderLinkIcon(lnk)}
                    {lnk.type}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Card Content Body */}
      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Title and Dates */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-semibold text-base tracking-tight text-foreground flex items-center gap-1.5">
              <span>{title}</span>
              {href && href !== "#" && (
                <Link
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Open ${title}`}
                >
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </h3>
            {dates && <time className="text-xs text-muted-foreground">{dates}</time>}
          </div>
        </div>

        {/* Markdown Description */}
        <div className="text-xs flex-1 prose max-w-full text-pretty font-sans leading-relaxed text-muted-foreground dark:prose-invert">
          <Markdown>{description}</Markdown>
        </div>

        {/* Technologies / Tags */}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-2">
            {tags.map((tag) => (
              <Badge
                key={tag}
                className="text-[11px] font-medium border border-border/50 bg-muted/40 h-6 w-fit px-2"
                variant="outline"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Action Links (displayed at bottom of card if no media banner at top) */}
        {!hasMedia && links && links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-border/40">
            {links.map((lnk, idx) => (
              <Link
                href={lnk.href}
                key={idx}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-secondary/80 hover:bg-secondary text-secondary-foreground transition-all duration-200 border border-border/40 hover:scale-105"
              >
                {renderLinkIcon(lnk)}
                <span>{lnk.type}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
