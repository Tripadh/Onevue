/**
 * =========================================================================
 * OneVue Central Template Registry — TypeScript Definitions & Interface (Phase 2.1)
 *
 * Provides strongly-typed access to approved portfolio templates, versioned
 * releases, and compatibility verification against PublicProfileDTO versions.
 * =========================================================================
 */

import {
  APPROVAL_STATUS as RAW_APPROVAL_STATUS,
  TEMPLATE_CATALOG as RAW_TEMPLATE_CATALOG,
  getApprovedTemplateIds as rawGetApprovedTemplateIds,
  isTemplateApproved as rawIsTemplateApproved,
  isVersionApproved as rawIsVersionApproved,
  getApprovedTemplate as rawGetApprovedTemplate,
  validateTemplateSelection as rawValidateTemplateSelection,
  listApprovedTemplates as rawListApprovedTemplates,
} from "./template-registry.js";

export type TemplateApprovalStatus =
  | "approved"
  | "deprecated"
  | "experimental"
  | "rejected";

export const APPROVAL_STATUS = RAW_APPROVAL_STATUS as Record<
  string,
  TemplateApprovalStatus
>;

export interface TemplateRepository {
  type: string;
  url: string;
  defaultBranch?: string;
}

export interface TemplateAuthor {
  name: string;
  url?: string;
}

export interface TemplateCustomizationOptions {
  supportsAccentColor: boolean;
  supportsThemeMode: boolean;
  defaultAccentColor: string;
  defaultThemeMode: "light" | "dark" | "system";
  allowedThemeModes: readonly ("light" | "dark" | "system")[];
}

export interface TemplateArtifact {
  format: "static" | "ssr-bundle" | "esm";
  entrypoint: string;
  assetBaseUrl: string;
  checksum?: string;
}

export interface TemplateRelease {
  version: string;
  approvalStatus: TemplateApprovalStatus;
  supportedDtoVersions: readonly string[];
  supportedSections: readonly string[];
  customizationOptions: TemplateCustomizationOptions;
  artifact: TemplateArtifact;
  releasedAt: string;
  notes?: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  description: string;
  author: TemplateAuthor;
  repository: TemplateRepository;
  tags: readonly string[];
}

export interface TemplateDefinition extends TemplateItem {
  releases: Record<string, TemplateRelease>;
}

export interface ApprovedTemplateSummary extends TemplateItem {
  latestVersion: string;
  releases: TemplateRelease[];
}

export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  template?: TemplateItem;
  release?: TemplateRelease;
}

export const TEMPLATE_CATALOG: Record<string, TemplateDefinition> =
  RAW_TEMPLATE_CATALOG as any;

export function getApprovedTemplateIds(): string[] {
  return rawGetApprovedTemplateIds();
}

export function isTemplateApproved(templateId: string): boolean {
  return rawIsTemplateApproved(templateId);
}

export function isVersionApproved(
  templateId: string,
  version: string
): boolean {
  return rawIsVersionApproved(templateId, version);
}

export function getApprovedTemplate(
  templateId: string,
  version?: string
): { template: TemplateItem; release: TemplateRelease } | null {
  return rawGetApprovedTemplate(templateId, version);
}

export function validateTemplateSelection(
  templateId: string,
  templateVersion: string = "1.0.0",
  dtoVersion: string = "1.0.0"
): TemplateValidationResult {
  return rawValidateTemplateSelection(templateId, templateVersion, dtoVersion);
}

export function listApprovedTemplates(): ApprovedTemplateSummary[] {
  return rawListApprovedTemplates();
}
