import { ProfileValidationError } from "../domain-profile/validate";
import { sanitizeStoredText } from "../templates/registry";
import { isCustomIdentity, mappableFields, mappingCompatible } from "./builtins";
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
    ...(field.mapsTo ? { mapsTo: field.mapsTo } : {}),
  };
}

function fieldsForRecord(fields: CustomFieldDefinition[], recordId: string): CustomFieldDefinition[] {
  return fields.filter((field) => field.scope !== "record" || field.targetRecordId === recordId);
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
        const fields = fieldsForRecord(section.fields, binding.recordId)
          .map((field) => projectField(field, binding.values?.[field.id], options.templateId, hrefFor, strict))
          .filter((field): field is PublicCustomField => Boolean(field));
        if (fields.length) records.push({ id: binding.recordId, fields });
      }
    } else if (section.repeatable) {
      for (const entry of layout.entries) {
        if (entry.sectionId !== section.id) continue;
        const fields = fieldsForRecord(section.fields, entry.id)
          .map((field) => projectField(field, entry.values?.[field.id], options.templateId, hrefFor, strict))
          .filter((field): field is PublicCustomField => Boolean(field));
        if (fields.length) records.push({ id: entry.id, fields });
      }
    } else {
      const binding = layout.bindings.find((item) => item.sectionId === section.id && item.recordId === "");
      const fields = fieldsForRecord(section.fields, "")
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
        const mapsTo = typeof field.mapsTo === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(field.mapsTo) ? field.mapsTo : "";
        fields.push({
          id: field.id.slice(0, 40),
          key: typeof field.key === "string" ? field.key.slice(0, 40) : field.id.slice(0, 40),
          label: sanitizeStoredText(field.label).trim().slice(0, 80) || "Field",
          type: field.type as PublicCustomField["type"],
          order: typeof field.order === "number" ? field.order : fields.length,
          presentation: field.presentation as PublicCustomField["presentation"],
          value: rendered,
          ...(mapsTo ? { mapsTo } : {}),
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

function bucketFor(builtinKey: string, buckets: Record<string, Record<string, unknown>[]>): Record<string, unknown>[] {
  if (builtinKey === "certifications") return buckets.credentials || [];
  if (builtinKey === "contacts" || builtinKey === "contact" || builtinKey === "publicContact") return buckets.contact || [];
  if (builtinKey === "currentEmployment" || builtinKey === "employmentHistory" || builtinKey === "workExperience") {
    return buckets.experience || [];
  }
  if (builtinKey === "socialLinks" || builtinKey === "channels" || builtinKey === "links" || builtinKey === "resources") {
    return buckets.socialLinks || [];
  }
  if (
    builtinKey === "portfolio" ||
    builtinKey === "products" ||
    builtinKey === "caseStudies" ||
    builtinKey === "featuredContent" ||
    builtinKey === "services"
  ) {
    return buckets.projects || [];
  }
  if (builtinKey === "workSamples") return buckets.media || [];
  if (builtinKey === "pastCollaborations" || builtinKey === "audienceStats") return buckets.achievements || [];
  return buckets[builtinKey] || [];
}

function findMappedRecord(
  list: Record<string, unknown>[],
  recordId: string,
  builtinKey: string
): Record<string, unknown> | undefined {
  const match = list.find((item) => String(item.id || "") === recordId);
  if (match) return match;
  if (!recordId && builtinKey === "currentEmployment") {
    return list.find((item) => String(item.id || "") === "currentEmployment");
  }
  if (!recordId && list.length === 1 && !list[0].id) return list[0];
  return undefined;
}

function valueEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Fills an empty built-in public field from a mapped custom value.
 * A stored value always wins. The custom field remains available to the record card.
 */
export function applyRecordMappings(
  sections: PublicCustomSection[],
  buckets: Record<string, Record<string, unknown>[]>,
  identity: string
): void {
  if (!isCustomIdentity(identity)) return;
  for (const section of sections) {
    if (!section.builtinKey) continue;
    const catalog = mappableFields(identity, section.builtinKey);
    if (!catalog.length) continue;
    const list = bucketFor(section.builtinKey, buckets);
    for (const record of section.records) {
      const target = findMappedRecord(list, record.id, section.builtinKey || "");
      if (!target) continue;
      for (const field of record.fields) {
        if (!field.mapsTo) continue;
        const spec = catalog.find((item) => item.key === field.mapsTo);
        if (!spec || !mappingCompatible(field.type, spec.kind)) continue;
        const publicKey = spec.publicKey || spec.key;
        if (!valueEmpty(target[publicKey])) continue;
        const value = field.value;
        if (spec.kind === "text" || spec.kind === "url" || spec.kind === "date") {
          if (typeof value === "string" && value) target[publicKey] = value;
        } else if (spec.kind === "boolean" && typeof value === "boolean") {
          target[publicKey] = value;
        } else if (spec.kind === "number" && typeof value === "number") {
          target[publicKey] = value;
        } else if (spec.kind === "tags" && Array.isArray(value) && value.length) {
          target[publicKey] = value;
        }
      }
    }
  }
}

/** Drops built-in custom records whose ids are no longer on the profile. */
export function retainOwnedCustomRecords(
  sections: PublicCustomSection[],
  recordIds: Record<string, string[]> | undefined
): PublicCustomSection[] {
  if (!recordIds) return sections;
  const kept: PublicCustomSection[] = [];
  for (const section of sections) {
    if (!section.builtinKey || !section.repeatable) {
      kept.push(section);
      continue;
    }
    const allowed = recordIds[section.builtinKey];
    if (!allowed) {
      kept.push(section);
      continue;
    }
    const records = section.records.filter((record) => allowed.includes(record.id));
    if (records.length) kept.push({ ...section, records });
  }
  return kept;
}

export function projectRecordFields(
  fields: unknown,
  options: ProjectCustomLayoutOptions
): PublicCustomField[] {
  if (!Array.isArray(fields)) return [];
  const hrefFor = options.assetHref || defaultHref;
  const out: PublicCustomField[] = [];
  for (const item of fields) {
    if (!item || typeof item !== "object") continue;
    if ((item as Record<string, unknown>).visibility === "private") continue;
    const def: CustomFieldDefinition = {
      id: String((item as Record<string, unknown>).id || ""),
      key: String((item as Record<string, unknown>).key || (item as Record<string, unknown>).id || ""),
      label: String((item as Record<string, unknown>).label || ""),
      type: (item as Record<string, unknown>).type as any,
      required: false,
      visibility: ((item as Record<string, unknown>).visibility as any) || "public",
      order: Number((item as Record<string, unknown>).order) || 0,
      helpText: "",
      placeholder: "",
      retired: false,
      config: ((item as Record<string, unknown>).config as any) || {},
      createdAt: "",
      updatedAt: "",
      scope: "record",
      targetRecordId: "",
      mapsTo: String((item as Record<string, unknown>).mapsTo || ""),
    };
    const projected = projectField(def, (item as Record<string, unknown>).value, options.templateId, hrefFor, options.strict === true);
    if (projected) out.push(projected);
  }
  return out.sort((a, b) => a.order - b.order);
}
