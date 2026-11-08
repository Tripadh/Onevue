import { HomeIcon, NotebookIcon } from "lucide-react";

export interface SkillItem {
  name: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SocialLink {
  name: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  navbar: boolean;
}

export interface WorkItem {
  company: string;
  href?: string;
  badges?: readonly string[];
  location?: string;
  title: string;
  logoUrl?: string;
  start: string;
  end?: string;
  description?: string;
}

export interface EducationItem {
  school: string;
  href?: string;
  degree: string;
  logoUrl?: string;
  start: string;
  end?: string;
}

export interface ProjectItem {
  title: string;
  href?: string;
  dates?: string;
  active?: boolean;
  description?: string;
  technologies?: readonly string[];
  links?: readonly {
    type: string;
    href: string;
    icon?: React.ReactNode;
  }[];
  image?: string;
  video?: string;
}

export interface HackathonItem {
  title: string;
  dates?: string;
  location?: string;
  description?: string;
  image?: string;
  mlh?: string;
  win?: string;
  icon?: string;
  links?: readonly {
    title: string;
    icon?: React.ReactNode;
    href: string;
  }[];
}

/**
 * Default empty data structure.
 * Hardcoded demo-person content has been removed in P0.4 to prevent demo leakage.
 */
export const DATA = {
  name: "",
  initials: "",
  url: "",
  location: "",
  locationLink: "",
  description: "",
  summary: "",
  avatarUrl: "",
  skills: [] as readonly SkillItem[],
  navbar: [
    { href: "/", icon: HomeIcon, label: "Home" },
    { href: "/blog", icon: NotebookIcon, label: "Blog" },
  ],
  contact: {
    email: "",
    tel: "",
    social: {} as Record<string, SocialLink>,
  },
  work: [] as readonly WorkItem[],
  education: [] as readonly EducationItem[],
  projects: [] as readonly ProjectItem[],
  hackathons: [] as readonly HackathonItem[],
} as const;
