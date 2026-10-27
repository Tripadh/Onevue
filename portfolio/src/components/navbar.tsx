"use client";

import { usePathname } from "next/navigation";
import { Dock, DockIcon } from "@/components/magicui/dock";
import { ModeToggle } from "@/components/mode-toggle";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icons } from "@/components/icons";
import { DATA } from "@/data/resume";
import { HomeIcon, NotebookIcon } from "lucide-react";
import { usePortfolio } from "@/components/portfolio-context";

function renderSocialIcon(iconName: string) {
  switch (iconName) {
    case "github":
      return <Icons.github className="size-4" />;
    case "linkedin":
      return <Icons.linkedin className="size-4" />;
    case "x":
      return <Icons.x className="size-4" />;
    case "instagram":
      return <Icons.instagram className="size-4" />;
    case "email":
      return <Icons.email className="size-4" />;
    default:
      return <Icons.globe className="size-4" />;
  }
}

export default function Navbar() {
  const pathname = usePathname();
  const isPublicRoute = pathname ? pathname.startsWith("/p/") : false;
  const isDraftPreview = pathname ? pathname.startsWith("/preview") : false;
  const portfolio = usePortfolio();

  if (isDraftPreview) {
    return null;
  }

  // If on a public student profile route (/p/:username)
  if (isPublicRoute) {
    // If not found or error: Strictly never leak demo/static profile data!
    if (!portfolio) {
      return (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30">
          <Dock className="z-50 pointer-events-auto relative h-14 px-3 w-fit mx-auto flex items-center gap-1 rounded-full border border-border/40 bg-background/80 dark:bg-[#121212]/90 backdrop-blur-2xl shadow-2xl">
            <Tooltip>
              <TooltipTrigger asChild>
                <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                  <ModeToggle className="size-full cursor-pointer" />
                </DockIcon>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
              >
                <p>Theme</p>
                <TooltipArrow className="fill-primary" />
              </TooltipContent>
            </Tooltip>
          </Dock>
        </div>
      );
    }

    // Render the student's navigation items & verified links
    const navbarItems = [
      { href: "#hero", icon: HomeIcon, label: "Home" },
      { href: "#about", icon: NotebookIcon, label: "About" },
    ];

    const activeSocials = Object.entries(portfolio.contact.social).filter(
      ([_, s]) => s.navbar
    );

    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30">
        <Dock className="z-50 pointer-events-auto relative h-14 px-3 w-fit mx-auto flex items-center gap-1 rounded-full border border-border/40 bg-background/80 dark:bg-[#121212]/90 backdrop-blur-2xl shadow-2xl">
          {navbarItems.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <a href={item.href} aria-label={item.label} className="size-full flex items-center justify-center">
                  <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                    <item.icon className="size-4" />
                  </DockIcon>
                </a>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
              >
                <p>{item.label}</p>
                <TooltipArrow className="fill-primary" />
              </TooltipContent>
            </Tooltip>
          ))}

          {activeSocials.length > 0 && (
            <Separator
              orientation="vertical"
              className="h-5 m-auto w-px bg-border/60"
            />
          )}

          {activeSocials.map(([name, social], index) => {
            const isExternal = social.url.startsWith("http") || social.url.startsWith("mailto:");
            return (
              <Tooltip key={`social-${name}-${index}`}>
                <TooltipTrigger asChild>
                  <a
                    href={social.url}
                    target={isExternal && !social.url.startsWith("mailto:") ? "_blank" : undefined}
                    rel={isExternal && !social.url.startsWith("mailto:") ? "noopener noreferrer" : undefined}
                    aria-label={name}
                    className="size-full flex items-center justify-center"
                  >
                    <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                      {renderSocialIcon(social.iconName)}
                    </DockIcon>
                  </a>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={8}
                  className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
                >
                  <p>{name}</p>
                  <TooltipArrow className="fill-primary" />
                </TooltipContent>
              </Tooltip>
            );
          })}

          <Separator
            orientation="vertical"
            className="h-5 m-auto w-px bg-border/60"
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                <ModeToggle className="size-full cursor-pointer" />
              </DockIcon>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              sideOffset={8}
              className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
            >
              <p>Theme</p>
              <TooltipArrow className="fill-primary" />
            </TooltipContent>
          </Tooltip>
        </Dock>
      </div>
    );
  }

  // Fallback for isolated development / demo homepage (/)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30">
      <Dock className="z-50 pointer-events-auto relative h-14 px-3 w-fit mx-auto flex items-center gap-1 rounded-full border border-border/40 bg-background/80 dark:bg-[#121212]/90 backdrop-blur-2xl shadow-2xl">
        {DATA.navbar.map((item) => {
          const isExternal = item.href.startsWith("http");
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <a
                  href={item.href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  aria-label={item.label}
                  className="size-full flex items-center justify-center"
                >
                  <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                    <item.icon className="size-4" />
                  </DockIcon>
                </a>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
              >
                <p>{item.label}</p>
                <TooltipArrow className="fill-primary" />
              </TooltipContent>
            </Tooltip>
          );
        })}
        <Separator
          orientation="vertical"
          className="h-5 m-auto w-px bg-border/60"
        />
        {Object.entries(DATA.contact.social)
          .filter(([_, social]) => social.navbar)
          .map(([name, social], index) => {
            const isExternal = social.url.startsWith("http") || social.url.startsWith("mailto:");
            const IconComponent = social.icon;
            return (
              <Tooltip key={`social-${name}-${index}`}>
                <TooltipTrigger asChild>
                  <a
                    href={social.url}
                    target={isExternal && !social.url.startsWith("mailto:") ? "_blank" : undefined}
                    rel={isExternal && !social.url.startsWith("mailto:") ? "noopener noreferrer" : undefined}
                    aria-label={name}
                    className="size-full flex items-center justify-center"
                  >
                    <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                      <IconComponent className="size-4" />
                    </DockIcon>
                  </a>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={8}
                  className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
                >
                  <p>{name}</p>
                  <TooltipArrow className="fill-primary" />
                </TooltipContent>
              </Tooltip>
            );
          })}
        <Separator
          orientation="vertical"
          className="h-5 m-auto w-px bg-border/60"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <DockIcon className="rounded-full cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <ModeToggle className="size-full cursor-pointer" />
            </DockIcon>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={8}
            className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm shadow-xl"
          >
            <p>Theme</p>
            <TooltipArrow className="fill-primary" />
          </TooltipContent>
        </Tooltip>
      </Dock>
    </div>
  );
}
