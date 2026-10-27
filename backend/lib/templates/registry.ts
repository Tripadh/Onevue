import contract from "./contract.js";

export const APPROVED_TEMPLATE_IDS = ["magicui-portfolio"] as const;
export type ApprovedTemplateId = (typeof APPROVED_TEMPLATE_IDS)[number];

const contractIds = contract.APPROVED_TEMPLATE_IDS as readonly string[];
if (
  contractIds.length !== APPROVED_TEMPLATE_IDS.length ||
  contractIds.some((id, index) => id !== APPROVED_TEMPLATE_IDS[index])
) {
  throw new Error("Template registry does not match the approved template ids.");
}

export type IdentityName = "student" | "professional" | "freelancer" | "creator" | "business";
export type ContentBlockKind = "text" | "richText" | "link" | "repeatable" | "media" | "choice";

export interface ContentSectionDefinition {
  id: string;
  label: string;
  identities: IdentityName[];
  storage: "public-dto" | "identity-profile";
  publicKey: string | null;
  repeatable: boolean;
  blocks: ContentBlockKind[];
}

export interface TemplateVisibilityControl {
  id: string;
  label: string;
  description: string;
}

export interface TemplateDefinition {
  id: ApprovedTemplateId;
  version: string;
  name: string;
  role: "test-adapter";
  description: string;
  supportedSections: string[];
  supportedBlocks: ContentBlockKind[];
  requiredInputs: string[];
  media: {
    images: boolean;
    galleries: boolean;
    videoFile: boolean;
    videoEmbed: boolean;
    externalVideoUrl: boolean;
    privateAssets: boolean;
  };
  presentation: {
    accentColor: boolean;
    themeMode: boolean;
    typography: boolean;
    sectionVisibility: boolean;
    sectionOrder: boolean;
    entryOrder: boolean;
  };
  visibilityControls: TemplateVisibilityControl[];
  retainedSections: string[];
  limits: string[];
  defaultSectionOrder: string[];
}

export interface WebsitePresentation {
  accentColor: string;
  themeMode: "light" | "dark" | "system";
  visibleSections: string[];
  sectionOrder: string[];
}

export const CONTENT_SECTIONS = contract.CONTENT_SECTIONS as unknown as ContentSectionDefinition[];
export const listTemplates = contract.listTemplates as unknown as () => TemplateDefinition[];
export const getTemplate = contract.getTemplate as unknown as (id: string) => TemplateDefinition | null;
export const contentForIdentity = contract.contentForIdentity as unknown as (identity: IdentityName) => ContentSectionDefinition[];
export const partitionPublication = contract.partitionPublication as (
  templateId: string,
  dto: object
) => { displayed: string[]; retained: string[] };
export const retainedProfileKeys = contract.retainedProfileKeys as (
  templateId: string,
  identity: IdentityName,
  profile: object
) => string[];
export const sanitizeStoredText = contract.sanitizeStoredText as (value: string) => string;
export const presentationForTemplate = contract.presentationForTemplate as (
  templateId: string,
  customization: object
) => WebsitePresentation;
export const publishedCustomization = contract.publishedCustomization as (
  revisionPresentation: object | null | undefined,
  configCustomization: object | null | undefined,
  templateId?: string
) => WebsitePresentation;
export const rollbackPresentation = contract.rollbackPresentation as (
  revisionPresentation: object | null | undefined,
  templateId?: string
) => WebsitePresentation;
export const reorderEntries = contract.reorderEntries as <T>(list: T[], index: number, direction: number) => T[];

export function sanitizeIncomingStrings(value: unknown): unknown {
  if (typeof value === "string") return sanitizeStoredText(value);
  if (Array.isArray(value)) return value.map(sanitizeIncomingStrings);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    out[key] = sanitizeIncomingStrings(source[key]);
  }
  return out;
}
