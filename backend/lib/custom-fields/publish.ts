import { ProfileValidationError } from "../domain-profile/validate";
import { sanitizeStoredText } from "../templates/registry";
import { presentationForField } from "./capabilities";
import type {
  AssetFieldValue,
  CustomFieldDefinition,
  CustomLayout,
  PublicCustomField,
  PublicCustomRecord,
  PublicCustomSection,
  PublicCustomValue,
  VideoFieldValue,
} from "./types";
import { videoEmbedAllowed } from "./validate";

export interface ProjectCustomLayoutOptions {
  templateId: string;
  /** Publish rejects incomplete required fields and missing public assets. */
  strict?: boolean;
  assetHref?: (assetId: string) => string;
}

function isLayout(value: unknown): value is CustomLayout {
  return !!value && typeof value === "object" && Array.isArray((value as CustomLayout).sections);
}

function optionLabel(field: CustomFieldDefinition, value: string): string {
  return field.config.options?.find((option) => option.value === value)?.label || value;
}

function publicAsset(value: AssetFieldValue, hrefFor: (assetId: string) => string, label: string, strict: boolean) {
  const href = hrefFor(value.assetId);
  if (!href) {
    if (strict) throw new ProfileValidationError(`The file for ${label} is not available to publish.`);
    return null;
  }
  return { href, ...(value.fileName ? { fileName: sanitizeStoredText(value.fileName).slice(0, 120) } : {}) };
}

function publicValue(
  field: CustomFieldDefinition,
  value: unknown,
  hrefFor: (assetId: string) => string,
  strict: boolean
): PublicCustomValue | null {
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "text" || field.type === "textarea" || field.type === "date") {
    return typeof value === "string" && value ? sanitizeStoredText(value) : null;
  }
  if (field.type === "url") return typeof value === "string" && value ? value : null;
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (field.type === "boolean") return typeof value === "boolean" ? value : null;
  if (field.type === "select") return typeof value === "string" && value ? optionLabel(field, value) : null;
  if (field.type === "multiselect") {
    if (!Array.isArray(value)) return null;
    const labels = value
      .filter((item): item is string => typeof item === "string" && Boolean(item))
      .map((item) => optionLabel(field, item));
    return labels.length ? labels : null;
  }
  if (field.type === "tags") {
    if (!Array.isArray(value)) return null;
    const tags = value.filter((item): item is string => typeof item === "string" && Boolean(item));
    return tags.length ? tags : null;
  }
  if (field.type === "image" || field.type === "file") {
    if (!value || typeof value !== "object" || !("assetId" in value)) return null;
    return publicAsset(value as AssetFieldValue, hrefFor, field.label, strict);
  }
  if (field.type === "gallery") {
    if (!Array.isArray(value)) return null;
    const images = value
      .map((item) => (item && typeof item === "object" && "assetId" in item
        ? publicAsset(item as AssetFieldValue, hrefFor, field.label, strict)
        : null))
      .filter((item): item is { href: string; fileName?: string } => Boolean(item));
    return images.length ? images : null;
  }
  if (!value || typeof value !== "object" || !("url" in value)) return null;
  const url = (value as VideoFieldValue).url;
  if (typeof url !== "string" || !url) return null;
  return { href: url, embed: videoEmbedAllowed(url) };
}

function projectField(
  field: CustomFieldDefinition,
  value: unknown,
  templateId: string,
  hrefFor: (assetId: string) => string,
  strict: boolean
): PublicCustomField | null {
  if (field.retired || field.visibility !== "public") return null;
  const rendered = publicValue(field, value, hrefFor, strict);
  if (rendered === null || rendered === "") return null;
  const presentation = presentationForField(templateId, field.type);
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    order: field.order,
    ...(field.helpText ? { helpText: field.helpText } : {}),
    presentation,
    value: rendered,
  };
}

/**
 * Copies public custom fields into an immutable snapshot shape.
 * Private fields are omitted. The input layout is not modified.
 */
export function projectCustomLayout(layout: unknown, options: ProjectCustomLayoutOptions): PublicCustomSection[] {
  if (!isLayout(layout)) return [];
  const hrefFor = options.assetHref || (() => "");
  const strict = options.strict === true;
  const sections: PublicCustomSection[] = [];

  for (const section of layout.sections) {
    if (!section || section.hidden || section.visibility === "private") continue;
    const records: PublicCustomRecord[] = [];
    if (section.repeatable && section.builtinKey) {
      for (const binding of layout.bindings) {
        if (binding.sectionId !== section.id) continue;
        const fields = section.fields
          .map((field) => projectField(field, binding.values?.[field.id], options.templateId, hrefFor, strict))
          .filter((field): field is PublicCustomField => Boolean(field));
        if (fields.length) records.push({ id: binding.recordId, fields });
      }
    } else if (section.repeatable) {
      for (const entry of layout.entries) {
        if (entry.sectionId !== section.id) continue;
        const fields = section.fields
          .map((field) => projectField(field, entry.values?.[field.id], options.templateId, hrefFor, strict))
          .filter((field): field is PublicCustomField => Boolean(field));
        if (fields.length) records.push({ id: entry.id, fields });
      }
    } else {
      const binding = layout.bindings.find((item) => item.sectionId === section.id && item.recordId === "");
      const fields = section.fields
        .map((field) => projectField(field, binding?.values?.[field.id], options.templateId, hrefFor, strict))
        .filter((field): field is PublicCustomField => Boolean(field));
      if (fields.length) records.push({ id: "", fields });
    }
    if (!records.length) continue;
    sections.push({
      id: section.id,
      key: section.key,
      title: section.title,
      ...(section.description ? { description: section.description } : {}),
      ...(section.builtinKey ? { builtinKey: section.builtinKey } : {}),
      order: section.order,
      repeatable: section.repeatable,
      records,
    });
  }
  return sections;
}

const PRESENTATIONS = new Set([
  "inline",
  "detail",
  "link",
  "image",
  "gallery",
  "video",
  "file",
  "tags",
  "number",
  "boolean",
  "hidden",
]);

function cleanPublicValue(type: string, value: unknown, hrefOk: (value: string) => string | undefined): PublicCustomValue | null {
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
  if (type === "boolean") return typeof value === "boolean" ? value : null;
  if (type === "tags" || type === "multiselect") {
    if (!Array.isArray(value)) return null;
    const items = value
      .map((item) => (typeof item === "string" ? sanitizeStoredText(item).trim().slice(0, 80) : ""))
      .filter(Boolean);
    return items.length ? items : null;
  }
  if (type === "image" || type === "file") {
    if (!value || typeof value !== "object") return null;
    const row = value as { href?: unknown; fileName?: unknown };
    const href = hrefOk(typeof row.href === "string" ? row.href : "");
    if (!href) return null;
    const fileName = typeof row.fileName === "string" ? sanitizeStoredText(row.fileName).trim().slice(0, 120) : "";
    return fileName ? { href, fileName } : { href };
  }
  if (type === "gallery") {
    if (!Array.isArray(value)) return null;
    const images = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { href?: unknown; fileName?: unknown };
        const href = hrefOk(typeof row.href === "string" ? row.href : "");
        if (!href) return null;
        const fileName = typeof row.fileName === "string" ? sanitizeStoredText(row.fileName).trim().slice(0, 120) : "";
        return fileName ? { href, fileName } : { href };
      })
      .filter((item): item is { href: string; fileName?: string } => Boolean(item));
    return images.length ? images : null;
  }
  if (type === "video") {
    if (!value || typeof value !== "object") return null;
    const href = hrefOk(typeof (value as { href?: unknown }).href === "string" ? (value as { href: string }).href : "");
    if (!href) return null;
    return { href, embed: videoEmbedAllowed(href) };
  }
  if (type === "url") {
    return typeof value === "string" ? hrefOk(value) || null : null;
  }
  if (typeof value !== "string") return null;
  const text = sanitizeStoredText(value).trim();
  return text ? text.slice(0, 4000) : null;
}

/** Second allowlist for a stored snapshot. Drops private-looking and unsafe values. */
export function sanitizePublicCustomSections(
  value: unknown,
  hrefOk: (value: string) => string | undefined
): PublicCustomSection[] {
  if (!Array.isArray(value)) return [];
  const sections: PublicCustomSection[] = [];
  for (const raw of value.slice(0, 24)) {
    if (!raw || typeof raw !== "object") continue;
    const section = raw as Record<string, unknown>;
    const title = typeof section.title === "string" ? sanitizeStoredText(section.title).trim().slice(0, 80) : "";
    if (!title || typeof section.id !== "string") continue;
    const records: PublicCustomRecord[] = [];
    const rawRecords = Array.isArray(section.records) ? section.records : [];
    for (const rawRecord of rawRecords.slice(0, 40)) {
      if (!rawRecord || typeof rawRecord !== "object") continue;
      const record = rawRecord as Record<string, unknown>;
      const fields: PublicCustomField[] = [];
      const rawFields = Array.isArray(record.fields) ? record.fields : [];
      for (const rawField of rawFields.slice(0, 30)) {
        if (!rawField || typeof rawField !== "object") continue;
        const field = rawField as Record<string, unknown>;
        if (typeof field.id !== "string" || typeof field.label !== "string" || typeof field.type !== "string") continue;
        if (typeof field.presentation !== "string" || !PRESENTATIONS.has(field.presentation)) continue;
        const rendered = cleanPublicValue(field.type, field.value, hrefOk);
        if (rendered === null) continue;
        fields.push({
          id: field.id.slice(0, 40),
          key: typeof field.key === "string" ? field.key.slice(0, 40) : field.id.slice(0, 40),
          label: sanitizeStoredText(field.label).trim().slice(0, 80) || "Field",
          type: field.type as PublicCustomField["type"],
          order: typeof field.order === "number" ? field.order : fields.length,
          presentation: field.presentation as PublicCustomField["presentation"],
          value: rendered,
        });
      }
      if (fields.length) records.push({ id: typeof record.id === "string" ? record.id.slice(0, 100) : "", fields });
    }
    if (!records.length) continue;
    const description = typeof section.description === "string" ? sanitizeStoredText(section.description).trim().slice(0, 300) : "";
    sections.push({
      id: section.id.slice(0, 40),
      key: typeof section.key === "string" ? section.key.slice(0, 40) : section.id.slice(0, 40),
      title,
      ...(description ? { description } : {}),
      ...(typeof section.builtinKey === "string" && section.builtinKey ? { builtinKey: section.builtinKey.slice(0, 40) } : {}),
      order: typeof section.order === "number" ? section.order : sections.length,
      repeatable: section.repeatable === true,
      records,
    });
  }
  return sections;
}
