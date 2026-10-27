/**
 * Magic UI is the only test adapter. These ids must match
 * backend/lib/templates/contract.js. The adapter reads them to decide
 * what to display. It does not remove stored profile content.
 */

export const MAGICUI_TEMPLATE_ID = "magicui-portfolio";

export const MAGICUI_CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "url",
  "date",
  "boolean",
  "select",
  "multiselect",
  "tags",
  "image",
  "gallery",
  "video",
  "file",
] as const;

export const MAGICUI_SUPPORTED_SECTIONS = [
  "profile",
  "about",
  "experience",
  "education",
  "skills",
  "projects",
  "services",
  "products",
  "caseStudies",
  "featured",
  "credentials",
  "highlights",
  "hackathons",
  "testimonials",
  "team",
  "media",
  "contact",
] as const;

export const RETAINED_PUBLIC_FIELDS = [
  "profile.languages",
  "profile.careerInterests",
  "profile.areasOfInterest",
  "profile.nationality",
  "profile.currentStatus",
] as const;

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function hasContent(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Fields present on a 1.0.0 snapshot that this test adapter does not render. */
export function retainedPublicFields(dto: object): string[] {
  return RETAINED_PUBLIC_FIELDS.filter((path) => hasContent(readPath(dto, path)));
}

export function templateSupports(templateId: string | undefined, sectionId: string): boolean {
  const id = templateId || MAGICUI_TEMPLATE_ID;
  if (id !== MAGICUI_TEMPLATE_ID) return false;
  return (MAGICUI_SUPPORTED_SECTIONS as readonly string[]).includes(sectionId);
}
