/**
 * OneVue Local Public Template Serving — TypeScript Definitions & Interface (Phase 2.4.4)
 * Provides strongly typed access to local template serving engine.
 */

import type { PublicProfileDTO_v1, WebsiteMetadata } from "./onevue-profile-adapter";
import {
  TEMPLATE_ID as RAW_TEMPLATE_ID,
  TEMPLATE_VERSION as RAW_TEMPLATE_VERSION,
  SUPPORTED_DTO_SCHEMA_VERSION as RAW_SUPPORTED_DTO_SCHEMA_VERSION,
  APPROVED_TEMPLATE_REGISTRY as RAW_APPROVED_TEMPLATE_REGISTRY,
  validateTemplateRelease as rawValidateTemplateRelease,
  resolveTemplatesRootDir as rawResolveTemplatesRootDir,
  isRegistryTemplate as rawIsRegistryTemplate,
  resolveTemplateArtifactPath as rawResolveTemplateArtifactPath,
  serializeDtoPayload as rawSerializeDtoPayload,
  injectDtoIntoHtml as rawInjectDtoIntoHtml,
  renderPublicTemplateHtml as rawRenderPublicTemplateHtml,
} from "./template-renderer.js";

// Artifact storage roots are backend-owned. Re-exported here so callers keep a
// single import surface without a second resolution implementation.
export { resolveTemplateStorageRoot, resolveTemplateArtifactsRoot } from "./template-artifact-store";

export const TEMPLATE_ID: string = RAW_TEMPLATE_ID;
export const TEMPLATE_VERSION: string = RAW_TEMPLATE_VERSION;
export const SUPPORTED_DTO_SCHEMA_VERSION: string = RAW_SUPPORTED_DTO_SCHEMA_VERSION;

export interface ApprovedTemplateRegistration {
  name: string;
  approvedVersions: readonly string[];
  supportedDtoVersions: readonly string[];
  entrypoint: string;
}

export const APPROVED_TEMPLATE_REGISTRY: Record<string, ApprovedTemplateRegistration> =
  RAW_APPROVED_TEMPLATE_REGISTRY as any;

export interface RenderTemplateOptions {
  dto: PublicProfileDTO_v1;
  website: WebsiteMetadata;
  templatesRootDir?: string;
  /**
   * Entrypoint document already delivered and integrity-verified through the
   * backend artifact delivery boundary. Required for dynamically stored
   * releases, which have no bundled entrypoint.
   */
  entrypointHtml?: string;
}

export interface SeoMetadataOptions {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  profilePhoto?: string;
}

export function validateTemplateRelease(templateId: string, version: string): void {
  rawValidateTemplateRelease(templateId, version);
}

export function resolveTemplatesRootDir(customDir?: string): string {
  return rawResolveTemplatesRootDir(customDir);
}

/**
 * Reports whether a template is a built-in, registry-approved template.
 */
export function isRegistryTemplate(templateId: string): boolean {
  return rawIsRegistryTemplate(templateId);
}

export function resolveTemplateArtifactPath(
  templateId: string,
  version: string,
  customRootDir?: string
): string {
  return rawResolveTemplateArtifactPath(templateId, version, customRootDir);
}

export function serializeDtoPayload(payload: {
  dto: PublicProfileDTO_v1;
  website: WebsiteMetadata;
}): string {
  return rawSerializeDtoPayload(payload);
}

export function injectDtoIntoHtml(
  rawHtml: string,
  safeJsonPayload: string,
  seo?: SeoMetadataOptions
): string {
  return rawInjectDtoIntoHtml(rawHtml, safeJsonPayload, seo);
}

export function renderPublicTemplateHtml(options: RenderTemplateOptions): string {
  return rawRenderPublicTemplateHtml(options);
}
