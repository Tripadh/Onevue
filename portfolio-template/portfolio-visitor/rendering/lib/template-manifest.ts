/**
 * OneVue Template Manifest — Canonical Template ID: magicui-portfolio
 * Declares supported DTO version, sections, and customization options.
 */

export const TEMPLATE_ID = "magicui-portfolio" as const;
export const TEMPLATE_VERSION = "1.0.0" as const;
export const SUPPORTED_DTO_SCHEMA_VERSION = "1.0.0" as const;

export interface TemplateManifest {
  id: typeof TEMPLATE_ID;
  version: typeof TEMPLATE_VERSION;
  name: string;
  description: string;
  supportedDtoVersion: typeof SUPPORTED_DTO_SCHEMA_VERSION;
  supportedSections: readonly string[];
  customizationOptions: {
    supportsAccentColor: boolean;
    supportsThemeMode: boolean;
    defaultAccentColor: string;
    defaultThemeMode: "light" | "dark" | "system";
  };
}

export const MAGICUI_TEMPLATE_MANIFEST: TemplateManifest = {
  id: TEMPLATE_ID,
  version: TEMPLATE_VERSION,
  name: "Magic UI Developer Portfolio",
  description:
    "A clean, typography-focused developer portfolio featuring smooth blur-fade animations, interactive dock, and verified credential highlights.",
  supportedDtoVersion: SUPPORTED_DTO_SCHEMA_VERSION,
  supportedSections: [
    "hero",
    "about",
    "education",
    "skills",
    "projects",
    "work",
    "hackathons",
    "credentials",
    "contact",
  ],
  customizationOptions: {
    supportsAccentColor: true,
    supportsThemeMode: true,
    defaultAccentColor: "#3b82f6",
    defaultThemeMode: "system",
  },
};
