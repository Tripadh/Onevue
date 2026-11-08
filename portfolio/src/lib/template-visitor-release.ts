/**
 * =========================================================================
 * OneVue Phase 5.14 — Public Visitor Template Release Resolution
 * =========================================================================
 *
 * Resolves the immutable template release for a published profile THROUGH the
 * backend artifact delivery boundary and hands the visitor the exact entrypoint
 * document that boundary verified.
 *
 * The published revision carries the exact template identity and version. That
 * identity is used to resolve the release, and a missing artifact, missing
 * manifest, invalid manifest or failed SHA-256 check is a typed failure so the
 * caller can commit the designed 404/500 experience instead of silently
 * serving another release.
 */

import {
  resolveTemplateEntrypointHtml,
  resolveTemplateRelease,
  type ArtifactResolution,
  type ResolvedTemplateRelease,
} from "./template-artifact-store";
import { TEMPLATE_ID, TEMPLATE_VERSION } from "./template-renderer.js";

export type VisitorReleaseResolution =
  | { ok: true; release: ResolvedTemplateRelease }
  | { ok: false; resolution: ArtifactResolution };

export interface VisitorEntrypointResolution {
  ok: boolean;
  html?: string;
  release?: ResolvedTemplateRelease;
  resolution: ArtifactResolution;
}

/**
 * Resolves and validates the published release without serving it.
 *
 * The template identity and version default exactly as the renderer does
 * (built-in MagicUI), so the release that is validated is always the release
 * that is rendered. The two must never diverge.
 */
export async function resolveVisitorTemplateRelease(
  templateId?: string,
  templateVersion?: string
): Promise<VisitorReleaseResolution> {
  const cleanId = (templateId || TEMPLATE_ID).trim();
  const cleanVersion = (templateVersion || TEMPLATE_VERSION).trim();

  const { release, resolution } = await resolveTemplateRelease(cleanId, cleanVersion);

  if (!release || !resolution.ok) {
    return { ok: false, resolution };
  }

  return { ok: true, release };
}

/**
 * Resolves the entrypoint document the visitor renders, through the same
 * delivery surface as every other asset (built-in bundled directory, backend
 * delivery API, or the in-process backend boundary).
 */
export async function resolveVisitorEntrypoint(
  templateId?: string,
  templateVersion?: string
): Promise<VisitorEntrypointResolution> {
  const cleanId = (templateId || TEMPLATE_ID).trim();
  const cleanVersion = (templateVersion || TEMPLATE_VERSION).trim();

  const { html, release, resolution } = await resolveTemplateEntrypointHtml(
    cleanId,
    cleanVersion
  );

  if (!html || !release || !resolution.ok) {
    return { ok: false, resolution };
  }

  return { ok: true, html, release, resolution };
}
