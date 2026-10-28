import { randomBytes } from "crypto";
import { ProfileValidationError } from "../domain-profile/validate";
import { sanitizeStoredText } from "../templates/registry";
import type { AssetPurpose } from "../storage/purposes";
import {
  builtinByKey,
  isCustomIdentity,
  mappableFields,
  mappingCompatible,
  patchTouchesBuiltinRecords,
  recordIdsForIdentity,
} from "./builtins";
import {
  CUSTOM_FIELD_LIMITS as LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_LAYOUT_SCHEMA_VERSION,
  FILE_MIME_TYPES,
  IMAGE_MIME_TYPES,
  emptyCustomLayout,
  type AssetFieldValue,
  type CustomBinding,
  type CustomEntry,
  type AttachmentScope,
  type CustomFieldConfig,
  type CustomFieldDefinition,
  type CustomFieldType,
  type RecordCustomField,
  type CustomFieldValue,
  type CustomIdentity,
  type CustomLayout,
  type CustomSection,
  type SelectOption,
  type VideoFieldValue,
} from "./types";

const FIELD_TYPES = new Set<string>(CUSTOM_FIELD_TYPES);
const ID_RE = /^(sec|fld|ent)_[a-z0-9]{8,32}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const OPTION_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const ASSET_RE = /^ast_[a-f0-9]{24}$/;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const VIDEO_EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

export interface NormalizeCustomLayoutOptions {
  identity: CustomIdentity;
  existing?: unknown;
  recordIds?: Record<string, string[]>;
  now?: string;
  /** Publish-time check. Draft saves accept missing required values. */
  enforceRequired?: boolean;
  /**
   * A profile save that removed a record keeps the old link instead of failing
   * or moving its values onto another record. A direct custom-field save still rejects unknown ids.
   */
  preserveMissingRecords?: boolean;
}

export interface SyncCustomLayoutInput {
  identity: string;
  existingProfile: Record<string, unknown>;
  patch?: Record<string, unknown>;
  incoming: unknown;
  incomingPresent: boolean;
}

function fail(message: string, status = 400): never {
  throw new ProfileValidationError(message, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlain(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`Field '${path}' must be an object.`);
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || BLOCKED_KEYS.has(key)) {
      fail(`Unsupported field '${key}'.`);
    }
  }
  return value;
}

function cleanText(value: unknown, path: string, max: number, required = false): string {
  if (typeof value !== "string") fail(`Field '${path}' must be a string.`);
  const text = sanitizeStoredText(value).trim();
  if (required && !text) fail(`Field '${path}' is required.`);
  if (text.length > max) fail(`Field '${path}' cannot exceed ${max} characters.`);
  return text;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function httpUrl(value: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Field '${path}' must be an http or https URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`Field '${path}' must be an http or https URL.`);
  }
  return value;
}

function createId(prefix: "sec" | "fld" | "ent"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function slugKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, LIMITS.maxKey);
  const base = /^[a-z]/.test(slug) ? slug : `field_${slug}`.replace(/_+$/g, "");
  return base.slice(0, LIMITS.maxKey) || "field";
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base || "field";
  let n = 2;
  while (taken.has(key)) {
    const suffix = `_${n}`;
    key = `${base.slice(0, LIMITS.maxKey - suffix.length)}${suffix}`;
    n += 1;
  }
  taken.add(key);
  return key;
}

function asExistingLayout(value: unknown): CustomLayout | null {
  if (!isPlainObject(value)) return null;
  return value as unknown as CustomLayout;
}

function fieldIndex(layout: CustomLayout | null): Map<string, CustomFieldDefinition> {
  const map = new Map<string, CustomFieldDefinition>();
  if (!layout || !Array.isArray(layout.sections)) return map;
  for (const section of layout.sections) {
    if (!section || !Array.isArray(section.fields)) continue;
    for (const field of section.fields) {
      if (field && typeof field.id === "string") map.set(field.id, field);
    }
  }
  return map;
}

function sectionIndex(layout: CustomLayout | null): Map<string, CustomSection> {
  const map = new Map<string, CustomSection>();
  if (!layout || !Array.isArray(layout.sections)) return map;
  for (const section of layout.sections) {
    if (section && typeof section.id === "string") map.set(section.id, section);
  }
  return map;
}

function readId(value: unknown, prefix: "sec" | "fld" | "ent"): string {
  if (typeof value === "string" && ID_RE.test(value) && value.startsWith(prefix + "_")) return value;
  return createId(prefix);
}

function mimeAllowlist(type: CustomFieldType): readonly string[] {
  return type === "file" ? FILE_MIME_TYPES : IMAGE_MIME_TYPES;
}

function normalizeConfig(type: CustomFieldType, raw: unknown, path: string): CustomFieldConfig {
  const source = raw === undefined || raw === null ? {} : assertPlain(raw, `${path}.config`);
  if (type === "text" || type === "textarea" || type === "heading") {
    const maxLen = type === "heading" ? 150 : (config.maxLength || LIMITS.textMax);
    const cap = type === "text" ? LIMITS.textMax : LIMITS.textareaMax;
    const maxLength = readBound(source.maxLength, 1, cap, cap, `${path}.maxLength`);
    const minLength = readBound(source.minLength, 0, maxLength, 0, `${path}.minLength`);
    return { minLength, maxLength };
  }
  if (type === "number") {
    const min = readOptionalNumber(source.min, -1e12, 1e12, `${path}.min`);
    const max = readOptionalNumber(source.max, -1e12, 1e12, `${path}.max`);
    if (min !== undefined && max !== undefined && min > max) {
      fail(`Field '${path}.min' cannot exceed max.`);
    }
    return {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      integer: source.integer === true,
    };
  }
  if (type === "select" || type === "multiselect") {
    if (!Array.isArray(source.options) || source.options.length === 0) {
      fail(`Field '${path}' needs at least one option.`);
    }
    if (source.options.length > LIMITS.maxOptions) {
      fail(`Field '${path}' cannot have more than ${LIMITS.maxOptions} options.`);
    }
    const seen = new Set<string>();
    const options: SelectOption[] = source.options.map((option, index) => {
      const row = assertPlain(option, `${path}.options[${index}]`);
      const label = cleanText(row.label, `${path}.options[${index}].label`, LIMITS.maxOptionLabel, true);
      let value = typeof row.value === "string" ? row.value.trim() : "";
      if (!OPTION_RE.test(value)) value = uniqueKey(slugKey(label), seen);
      else if (seen.has(value)) fail(`Field '${path}' has a duplicate option.`);
      else seen.add(value);
      return { value, label };
    });
    const config: CustomFieldConfig = { options };
    if (type === "multiselect") {
      const cap = options.length;
      config.maxSelections = readBound(source.maxSelections, 1, cap, cap, `${path}.maxSelections`);
    }
    return config;
  }
  if (type === "tags") {
    return {
      maxItems: readBound(source.maxItems, 1, LIMITS.tagsMax, LIMITS.tagsMax, `${path}.maxItems`),
      itemMaxLength: readBound(source.itemMaxLength, 1, LIMITS.tagLength, LIMITS.tagLength, `${path}.itemMaxLength`),
    };
  }
  if (type === "image" || type === "gallery" || type === "file") {
    const allowed = mimeAllowlist(type);
    const accept = Array.isArray(source.accept) && source.accept.length
      ? source.accept.map((item, index) => {
          if (typeof item !== "string" || !allowed.includes(item as (typeof allowed)[number])) {
            fail(`Field '${path}.accept[${index}]' is not an allowed file type.`);
          }
          return item;
        })
      : [...allowed];
    const byteCap = type === "file" ? LIMITS.fileMaxBytes : LIMITS.imageMaxBytes;
    const config: CustomFieldConfig = {
      accept,
      maxBytes: readBound(source.maxBytes, 1, byteCap, byteCap, `${path}.maxBytes`),
    };
    if (type === "gallery") {
      config.maxItems = readBound(source.maxItems, 1, LIMITS.galleryMax, LIMITS.galleryMax, `${path}.maxItems`);
    }
    return config;
  }
  return {};
}

function readBound(value: unknown, min: number, max: number, fallback: number, path: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) fail(`Field '${path}' must be a whole number.`);
  if (value < min || value > max) fail(`Field '${path}' must be between ${min} and ${max}.`);
  return value;
}

function readOptionalNumber(value: unknown, min: number, max: number, path: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`Field '${path}' must be a number.`);
  if (value < min || value > max) fail(`Field '${path}' must be between ${min} and ${max}.`);
  return value;
}

function normalizeAsset(value: unknown, path: string): AssetFieldValue {
  const row = assertPlain(value, path);
  const assetId = typeof row.assetId === "string" ? row.assetId.trim() : "";
  if (!ASSET_RE.test(assetId)) fail(`Field '${path}' is not a valid asset reference.`);
  const fileName = typeof row.fileName === "string" ? sanitizeStoredText(row.fileName).trim().slice(0, LIMITS.fileNameMax) : "";
  return { assetId, fileName };
}

function valueMissing(type: CustomFieldType, value: CustomFieldValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (type === "boolean") return false;
  if (type === "number") return false;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (type === "video") return !(value as VideoFieldValue).url;
  if (type === "image" || type === "file") return !(value as AssetFieldValue).assetId;
  return false;
}

function normalizeValue(field: CustomFieldDefinition, value: unknown, path: string): CustomFieldValue {
  const { type, config } = field;
  if (value === undefined || value === null || value === "") return null;
  if (type === "text" || type === "textarea" || type === "heading") {
    const maxLen = type === "heading" ? 150 : (config.maxLength || LIMITS.textMax);
    const text = cleanText(value, path, typeof maxLen !== "undefined" ? maxLen : (config.maxLength || LIMITS.textMax));
    const min = config.minLength || 0;
    if (text && text.length < min) fail(`Field '${path}' must be at least ${min} characters.`);
    return text;
  }
  if (type === "url") {
    const text = cleanText(value, path, 500);
    if (!text) return null;
    return httpUrl(text, path);
  }
  if (type === "date") {
    const text = cleanText(value, path, 10);
    if (!text) return null;
    if (!isIsoDate(text)) fail(`Field '${path}' must be a valid date in YYYY-MM-DD format.`);
    return text;
  }
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(`Field '${path}' must be a number.`);
    if (config.integer && !Number.isInteger(value)) fail(`Field '${path}' must be a whole number.`);
    if (config.min !== undefined && value < config.min) fail(`Field '${path}' must be at least ${config.min}.`);
    if (config.max !== undefined && value > config.max) fail(`Field '${path}' must be at most ${config.max}.`);
    return value;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") fail(`Field '${path}' must be true or false.`);
    return value;
  }
  if (type === "select") {
    const text = cleanText(value, path, 80);
    if (!text) return null;
    if (!config.options?.some((option) => option.value === text)) {
      fail(`Field '${path}' is not one of the allowed options.`);
    }
    return text;
  }
  if (type === "multiselect" || type === "tags") {
    if (!Array.isArray(value)) fail(`Field '${path}' must be a list.`);
    const cap = type === "tags" ? config.maxItems || LIMITS.tagsMax : config.maxSelections || LIMITS.maxOptions;
    if (value.length > cap) fail(`Field '${path}' cannot exceed ${cap} items.`);
    const items: string[] = [];
    value.forEach((entry, index) => {
      const text = cleanText(entry, `${path}[${index}]`, type === "tags" ? config.itemMaxLength || LIMITS.tagLength : 80);
      if (!text || items.includes(text)) return;
      if (type === "multiselect" && !config.options?.some((option) => option.value === text)) {
        fail(`Field '${path}[${index}]' is not one of the allowed options.`);
      }
      items.push(text);
    });
    return items;
  }
  if (type === "image" || type === "file") return normalizeAsset(value, path);
  if (type === "gallery") {
    if (!Array.isArray(value)) fail(`Field '${path}' must be a list of images.`);
    const cap = config.maxItems || LIMITS.galleryMax;
    if (value.length > cap) fail(`Field '${path}' cannot exceed ${cap} images.`);
    const images: AssetFieldValue[] = [];
    value.forEach((entry, index) => {
      if (!entry || (isPlainObject(entry) && !entry.assetId)) return;
      images.push(normalizeAsset(entry, `${path}[${index}]`));
    });
    return images;
  }
  const row = assertPlain(value, path);
  const url = cleanText(row.url, `${path}.url`, 500);
  if (!url) return null;
  return { kind: "url", url: httpUrl(url, `${path}.url`) };
}

function cleanRecordId(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`Field '${path}' must be a record id.`);
  const id = value.trim();
  if (!id || id.length > 100 || id.includes("$") || id.includes(".") || id.includes("/")) {
    fail(`Field '${path}' is not a valid record id.`);
  }
  return id;
}

function fieldsOnRecord(section: CustomSection, recordId: string): CustomFieldDefinition[] {
  return section.fields.filter((field) => field.scope !== "record" || field.targetRecordId === recordId);
}

function assertMappingConflicts(fields: CustomFieldDefinition[], sectionTitle: string) {
  const active = fields.filter((field) => field.mapsTo && !field.retired);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].mapsTo !== active[j].mapsTo) continue;
      const left = active[i].scope === "record" ? active[i].targetRecordId : "*";
      const right = active[j].scope === "record" ? active[j].targetRecordId : "*";
      if (left === "*" || right === "*" || left === right) {
        fail(`Only one custom field can map to ${active[i].mapsTo} on ${sectionTitle}.`);
      }
    }
  }
}

interface AttachmentContext {
  identity: CustomIdentity;
  builtinKey: string | null;
  sectionTitle: string;
  repeatable: boolean;
  recordIds: Record<string, string[]>;
  preserveMissingRecords: boolean;
}

function attachmentFor(
  row: Record<string, unknown>,
  id: string,
  label: string,
  type: CustomFieldType,
  path: string,
  previous: Map<string, CustomFieldDefinition>,
  context: AttachmentContext
): { scope: AttachmentScope; targetRecordId: string; mapsTo: string } {
  const requested = row.scope === "record" ? "record" : "section";
  const rawTarget = typeof row.targetRecordId === "string" ? row.targetRecordId.trim() : "";
  const mapsTo = typeof row.mapsTo === "string" ? row.mapsTo.trim() : "";
  if (!context.builtinKey) {
    if (requested === "record" || rawTarget) {
      fail(`Custom section '${context.sectionTitle}' uses its own records. Link an existing record from a built-in section.`);
    }
    if (mapsTo) fail(`Custom section '${context.sectionTitle}' cannot map onto a built-in field.`);
    return { scope: "section", targetRecordId: "", mapsTo: "" };
  }
  if (!context.repeatable && requested === "record") {
    fail(`'${label}' applies to the whole ${context.sectionTitle} section.`);
  }
  let targetRecordId = "";
  if (requested === "record") {
    targetRecordId = cleanRecordId(rawTarget, `${path}.targetRecordId`);
    const allowed = context.recordIds[context.builtinKey] || [];
    const prior = previous.get(id);
    const preserved =
      context.preserveMissingRecords && prior?.scope === "record" && prior.targetRecordId === targetRecordId;
    if (!allowed.includes(targetRecordId) && !preserved) {
      fail(`'${label}' is linked to a record that is not on this profile.`);
    }
  } else if (rawTarget) {
    fail(`'${label}' targets one record. Choose the existing-record attachment.`);
  }
  if (mapsTo) {
    const match = mappableFields(context.identity, context.builtinKey).find((field) => field.key === mapsTo);
    if (!match) fail(`'${label}' cannot map to '${mapsTo}'. That field is not on this section.`);
    if (!mappingCompatible(type, match.kind)) {
      fail(`'${label}' cannot map to ${match.label} because the field types do not match.`);
    }
  }
  return { scope: requested, targetRecordId, mapsTo };
}

function normalizeFields(
  rawFields: unknown,
  path: string,
  previous: Map<string, CustomFieldDefinition>,
  usedIds: Set<string>,
  now: string,
  attachment: AttachmentContext
): CustomFieldDefinition[] {
  if (!Array.isArray(rawFields)) fail(`Field '${path}.fields' must be a list.`);
  if (rawFields.length > LIMITS.maxFieldsPerSection) {
    fail(`A section cannot have more than ${LIMITS.maxFieldsPerSection} custom fields.`);
  }
  const takenKeys = new Set<string>();
  if (Array.isArray(rawFields)) {
    for (const raw of rawFields) {
      if (!isPlainObject(raw) || typeof raw.id !== "string" || !ID_RE.test(raw.id)) continue;
      const prior = previous.get(raw.id);
      if (prior) takenKeys.add(prior.key);
    }
  }
  const sortable = rawFields.map((raw, index) => ({ raw, index }));
  sortable.sort((a, b) => {
    const left = isPlainObject(a.raw) && typeof a.raw.order === "number" ? a.raw.order : a.index;
    const right = isPlainObject(b.raw) && typeof b.raw.order === "number" ? b.raw.order : b.index;
    return left - right || a.index - b.index;
  });
  const fields: CustomFieldDefinition[] = sortable.map(({ raw }, order) => {
    const row = assertPlain(raw, `${path}.fields[${order}]`);
    const id = readId(row.id, "fld");
    if (usedIds.has(id)) fail("Custom field ids must be unique.");
    usedIds.add(id);
    const prior = previous.get(id);
    const label = cleanText(row.label, `${path}.fields[${order}].label`, LIMITS.maxLabel, true);
    const typeValue = typeof row.type === "string" ? row.type : "";
    if (prior && prior.type !== typeValue) {
      fail(`Field '${label}' cannot change type. Remove it and add a new field.`);
    }
    if (!FIELD_TYPES.has(typeValue)) fail(`Field '${label}' has an unsupported type.`);
    const type = typeValue as CustomFieldType;
    const key = prior
      ? prior.key
      : uniqueKey(
          typeof row.key === "string" && KEY_RE.test(row.key) ? row.key : slugKey(label),
          takenKeys
        );
    const visibility: "public" | "private" = row.visibility === "private" ? "private" : "public";
    const linked = attachmentFor(row, id, label, type, `${path}.fields[${order}]`, previous, attachment);
    return {
      id,
      key,
      label,
      type,
      required: row.required === true,
      visibility,
      order,
      helpText: typeof row.helpText === "string" ? cleanText(row.helpText, `${path}.helpText`, LIMITS.maxHelp) : "",
      placeholder:
        typeof row.placeholder === "string" ? cleanText(row.placeholder, `${path}.placeholder`, LIMITS.maxPlaceholder) : "",
      retired: row.retired === true || prior?.retired === true && row.retired !== false,
      config: normalizeConfig(type, row.config, `${path}.fields[${order}]`),
      createdAt: prior?.createdAt || now,
      updatedAt: prior && prior.label === label && prior.required === (row.required === true) ? prior.updatedAt : now,
      scope: linked.scope,
      targetRecordId: linked.targetRecordId,
      mapsTo: linked.mapsTo,
    };
  });
  assertMappingConflicts(fields, attachment.sectionTitle);
  return fields;
}

function normalizeValueMap(
  fields: CustomFieldDefinition[],
  raw: unknown,
  path: string,
  enforceRequired: boolean,
  recordLabel: string
): Record<string, CustomFieldValue> {
  const source = raw === undefined || raw === null ? {} : assertPlain(raw, path);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const values: Record<string, CustomFieldValue> = {};
  for (const key of Object.keys(source)) {
    if (!byId.has(key)) continue;
    const field = byId.get(key)!;
    const normalized = normalizeValue(field, source[key], `${path}.${field.label}`);
    if (!valueMissing(field.type, normalized)) values[field.id] = normalized;
  }
  if (enforceRequired) {
    for (const field of fields) {
      if (!field.required || field.retired) continue;
      if (valueMissing(field.type, values[field.id])) {
        fail(`${field.label} is required${recordLabel ? " for " + recordLabel : ""}.`);
      }
    }
  }
  return values;
}

export function normalizeCustomLayout(input: unknown, options: NormalizeCustomLayoutOptions): CustomLayout {
  if (input === undefined) return emptyCustomLayout();
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("customLayout must be an object.");
  }
  const serialized = JSON.stringify(input);
  if (serialized.length > LIMITS.payloadChars) {
    fail("Custom field payload is too large.", 413);
  }
  const body = assertPlain(input, "customLayout");
  if (body.schemaVersion !== undefined && body.schemaVersion !== CUSTOM_LAYOUT_SCHEMA_VERSION) {
    fail("Custom field schema version is not supported.");
  }
  const existing = asExistingLayout(options.existing);
  const previousRevision = existing && typeof existing.revision === "number" ? existing.revision : 0;
  if (body.revision !== undefined && body.revision !== null && body.revision !== previousRevision) {
    if (typeof body.revision !== "number" || !Number.isInteger(body.revision)) {
      fail("Custom field revision is invalid.");
    }
    fail("This profile was updated somewhere else. Reload before saving custom fields.", 409);
  }
  const now = options.now || new Date().toISOString();
  const previousFields = fieldIndex(existing);
  const previousSections = sectionIndex(existing);
  const usedIds = new Set<string>();
  const rawSections = body.sections === undefined ? [] : body.sections;
  if (!Array.isArray(rawSections)) fail("Field 'customLayout.sections' must be a list.");
  if (rawSections.length > LIMITS.maxSections) fail(`A profile cannot have more than ${LIMITS.maxSections} custom sections.`);

  const sortable = rawSections.map((raw, index) => ({ raw, index }));
  sortable.sort((a, b) => {
    const left = isPlainObject(a.raw) && typeof a.raw.order === "number" ? a.raw.order : a.index;
    const right = isPlainObject(b.raw) && typeof b.raw.order === "number" ? b.raw.order : b.index;
    return left - right || a.index - b.index;
  });

  const recordIds = options.recordIds || {};
  const usedBuiltin = new Set<string>();
  const sectionKeys = new Set<string>();
  for (const item of sortable) {
    if (!isPlainObject(item.raw) || typeof item.raw.id !== "string") continue;
    const priorSection = previousSections.get(item.raw.id);
    if (priorSection) sectionKeys.add(priorSection.key);
  }
  const sections: CustomSection[] = sortable.map(({ raw }, order) => {
    const row = assertPlain(raw, `customLayout.sections[${order}]`);
    const id = readId(row.id, "sec");
    if (usedIds.has(id)) fail("Custom section ids must be unique.");
    usedIds.add(id);
    const title = cleanText(row.title, `customLayout.sections[${order}].title`, LIMITS.maxLabel, true);
    let builtinKey: string | null = null;
    if (row.builtinKey !== undefined && row.builtinKey !== null && row.builtinKey !== "") {
      if (typeof row.builtinKey !== "string") fail("A built-in section key must be a string.");
      const builtin = builtinByKey(options.identity, row.builtinKey);
      if (!builtin) fail(`'${row.builtinKey}' is not a section on this identity.`);
      if (usedBuiltin.has(builtin.key)) fail(`Only one custom field group is allowed for ${builtin.label}.`);
      usedBuiltin.add(builtin.key);
      builtinKey = builtin.key;
    }
    const repeatable = builtinKey
      ? builtinByKey(options.identity, builtinKey)!.repeatable
      : row.repeatable !== false;
    const sectionTitle = title;
    const priorSection = previousSections.get(id);
    const key = priorSection
      ? priorSection.key
      : uniqueKey(
          typeof row.key === "string" && KEY_RE.test(row.key) ? row.key : slugKey(title),
          sectionKeys
        );
    if (priorSection) sectionKeys.add(key);
    return {
      id,
      key,
      title,
      description:
        typeof row.description === "string"
          ? cleanText(row.description, `customLayout.sections[${order}].description`, LIMITS.maxDescription)
          : "",
      builtinKey,
      visibility: row.visibility === "private" ? "private" : "public",
      order,
      repeatable,
      hidden: row.hidden === true,
      fields: normalizeFields(row.fields, `customLayout.sections[${order}]`, previousFields, usedIds, now, {
        identity: options.identity,
        builtinKey,
        sectionTitle,
        repeatable,
        recordIds,
        preserveMissingRecords: options.preserveMissingRecords === true,
      }),
    };
  });

  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const bindings: CustomBinding[] = [];
  const rawBindings = body.bindings === undefined ? [] : body.bindings;
  if (!Array.isArray(rawBindings)) fail("Field 'customLayout.bindings' must be a list.");
  if (rawBindings.length > LIMITS.maxBindings) fail("Too many custom field values were submitted.");
  const seenBindings = new Set<string>();
  rawBindings.forEach((raw, index) => {
    const row = assertPlain(raw, `customLayout.bindings[${index}]`);
    const sectionId = typeof row.sectionId === "string" ? row.sectionId : "";
    const section = sectionById.get(sectionId);
    if (!section) return;
    if (!section.builtinKey && section.repeatable) {
      fail(`Custom section '${section.title}' stores values on its own records.`);
    }
    const recordId = typeof row.recordId === "string" ? row.recordId.trim() : "";
    if (section.repeatable) {
      const allowed = recordIds[section.builtinKey || ""] || [];
      if (!recordId || !allowed.includes(recordId)) {
        if (options.preserveMissingRecords === true && recordId) {
          // Keep the values on the removed record. Do not copy them onto another id.
        } else {
          fail(`Custom values for ${section.title} must belong to an existing record.`);
        }
      }
    } else if (recordId) {
      fail(`Custom values for ${section.title} do not use a record id.`);
    }
    const token = `${sectionId}:${recordId}`;
    if (seenBindings.has(token)) fail(`Duplicate custom values were submitted for ${section.title}.`);
    seenBindings.add(token);
    bindings.push({
      sectionId,
      recordId,
      values: normalizeValueMap(
        fieldsOnRecord(section, recordId),
        row.values,
        `customLayout.bindings[${index}].values`,
        options.enforceRequired === true,
        section.repeatable ? recordId : section.title
      ),
    });
  });

  const entries: CustomEntry[] = [];
  const rawEntries = body.entries === undefined ? [] : body.entries;
  if (!Array.isArray(rawEntries)) fail("Field 'customLayout.entries' must be a list.");
  const entryCounts = new Map<string, number>();
  const seenEntries = new Set<string>();
  const entrySort = rawEntries.map((raw, index) => ({ raw, index }));
  entrySort.sort((a, b) => {
    const left = isPlainObject(a.raw) && typeof a.raw.order === "number" ? a.raw.order : a.index;
    const right = isPlainObject(b.raw) && typeof b.raw.order === "number" ? b.raw.order : b.index;
    return left - right || a.index - b.index;
  });
  entrySort.forEach(({ raw }) => {
    const row = assertPlain(raw, "customLayout.entries");
    const sectionId = typeof row.sectionId === "string" ? row.sectionId : "";
    const section = sectionById.get(sectionId);
    if (!section || section.builtinKey || !section.repeatable) return;
    const count = entryCounts.get(sectionId) || 0;
    if (count >= LIMITS.maxEntriesPerSection) {
      fail(`${section.title} cannot have more than ${LIMITS.maxEntriesPerSection} records.`);
    }
    const id = readId(row.id, "ent");
    if (seenEntries.has(id)) fail("Custom section record ids must be unique.");
    seenEntries.add(id);
    entryCounts.set(sectionId, count + 1);
    entries.push({
      id,
      sectionId,
      order: count,
      values: normalizeValueMap(
        fieldsOnRecord(section, id),
        row.values,
        `customLayout.entries.${id}.values`,
        options.enforceRequired === true,
        section.title
      ),
    });
  });

  if (options.enforceRequired) {
    for (const section of sections) {
      if (!section.repeatable) {
        const binding = bindings.find((item) => item.sectionId === section.id);
        normalizeValueMap(fieldsOnRecord(section, ""), binding?.values || {}, section.title, true, section.title);
        continue;
      }
      if (!section.builtinKey) continue;
      const ids = recordIds[section.builtinKey] || [];
      for (const recordId of ids) {
        const binding = bindings.find((item) => item.sectionId === section.id && item.recordId === recordId);
        normalizeValueMap(fieldsOnRecord(section, recordId), binding?.values || {}, section.title, true, recordId);
      }
    }
  }

  return {
    schemaVersion: CUSTOM_LAYOUT_SCHEMA_VERSION,
    revision: previousRevision + (body.sections !== undefined || body.bindings !== undefined || body.entries !== undefined ? 1 : 0),
    sections,
    bindings,
    entries,
  };
}

export function syncCustomLayout(input: SyncCustomLayoutInput): CustomLayout | undefined {
  if (!isCustomIdentity(input.identity)) fail("Custom fields are not available for this identity.");
  const merged: Record<string, unknown> = { ...(input.existingProfile || {}) };
  if (input.patch) Object.assign(merged, input.patch);
  const recordIds = recordIdsForIdentity(input.identity, merged);
  const existing = input.existingProfile?.customLayout;
  const hasExisting = isPlainObject(existing) && Array.isArray((existing as { sections?: unknown }).sections)
    && ((existing as { sections: unknown[] }).sections.length > 0
      || (Array.isArray((existing as { bindings?: unknown }).bindings) && (existing as { bindings: unknown[] }).bindings.length > 0)
      || (Array.isArray((existing as { entries?: unknown }).entries) && (existing as { entries: unknown[] }).entries.length > 0));
  if (!input.incomingPresent && !hasExisting) return undefined;
  if (!input.incomingPresent && !patchTouchesBuiltinRecords(input.identity, input.patch)) return undefined;
  const normalized = normalizeCustomLayout(input.incomingPresent ? input.incoming : existing, {
    identity: input.identity,
    existing,
    recordIds,
    preserveMissingRecords: !input.incomingPresent,
  });
  if (!input.incomingPresent && layoutSignature(normalized) === layoutSignature(existing)) return undefined;
  return normalized;
}

function layoutSignature(value: unknown): string {
  if (!isPlainObject(value)) return "";
  return JSON.stringify({
    sections: value.sections || [],
    bindings: value.bindings || [],
    entries: value.entries || [],
  });
}

export function collectCustomAssetBindings(layout: unknown): { assetId: string; purpose: AssetPurpose }[] {
  if (!isPlainObject(layout)) return [];
  const sections = Array.isArray(layout.sections) ? layout.sections : [];
  const purposeByField = new Map<string, AssetPurpose>();
  for (const section of sections) {
    if (!isPlainObject(section) || !Array.isArray(section.fields)) continue;
    for (const field of section.fields) {
      if (!isPlainObject(field) || typeof field.id !== "string") continue;
      if (field.type === "image" || field.type === "gallery") purposeByField.set(field.id, "portfolio-image");
      if (field.type === "file") purposeByField.set(field.id, "portfolio-media");
    }
  }
  const found: { assetId: string; purpose: AssetPurpose }[] = [];
  const seen = new Set<string>();
  const visit = (values: unknown) => {
    if (!isPlainObject(values)) return;
    for (const [fieldId, value] of Object.entries(values)) {
      const purpose = purposeByField.get(fieldId);
      if (!purpose) continue;
      const rows = Array.isArray(value) ? value : [value];
      for (const row of rows) {
        if (!isPlainObject(row) || typeof row.assetId !== "string") continue;
        const assetId = row.assetId.trim();
        if (!ASSET_RE.test(assetId) || seen.has(assetId + purpose)) continue;
        seen.add(assetId + purpose);
        found.push({ assetId, purpose });
      }
    }
  };
  const groups = [
    ...(Array.isArray(layout.bindings) ? layout.bindings : []),
    ...(Array.isArray(layout.entries) ? layout.entries : []),
  ];
  for (const group of groups) {
    if (isPlainObject(group)) visit(group.values);
  }
  return found;
}

export function videoEmbedAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return VIDEO_EMBED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}


export function validateRecordCustomFields(
  input: unknown,
  path = "customFields",
  options: { enforceRequired?: boolean } = {}
): RecordCustomField[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) fail(`Field '${path}' must be an array.`);
  if (input.length > 30) fail(`Field '${path}' cannot exceed 30 items.`);

  const seenIds = new Set<string>();
  const result: RecordCustomField[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const row = input[i];
    const fieldPath = `${path}[${i}]`;
    if (!isPlainObject(row)) fail(`Field '${fieldPath}' must be an object.`);

    let id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) id = createId("fld");
    if (seenIds.has(id)) fail(`Field '${fieldPath}.id' duplicates another custom field.`);
    seenIds.add(id);

    const label = cleanText(row.label, `${fieldPath}.label`, LIMITS.maxLabel);
    if (!label) fail(`Field '${fieldPath}.label' is required.`);

    const type = row.type as CustomFieldType;
    if (!CUSTOM_FIELD_TYPES.includes(type)) {
      fail(`Field '${fieldPath}.type' is not supported.`);
    }

    const visibility = row.visibility === "private" ? "private" : "public";
    const order = typeof row.order === "number" && Number.isFinite(row.order) ? row.order : i;

    const def: CustomFieldDefinition = {
      id,
      key: slugKey(label),
      label,
      type,
      required: row.required === true,
      visibility,
      order,
      helpText: typeof row.helpText === "string" ? row.helpText.slice(0, LIMITS.maxHelp) : "",
      placeholder: typeof row.placeholder === "string" ? row.placeholder.slice(0, LIMITS.maxPlaceholder) : "",
      retired: false,
      config: isPlainObject(row.config) ? normalizeConfig(type, row.config, `${fieldPath}.config`) : {},
      createdAt: "",
      updatedAt: "",
      scope: "record",
      targetRecordId: "",
      mapsTo: "",
    };

    const normValue = normalizeValue(def, row.value, `${fieldPath}.value`);
    if (options.enforceRequired && def.required && valueMissing(type, normValue)) {
      fail(`${label} is required.`);
    }

    result.push({
      id,
      label,
      type,
      visibility,
      order,
      value: normValue,
    });
  }

  return result.sort((a, b) => a.order - b.order);
}

export function collectRecordCustomFieldAssets(fields: unknown): { assetId: string; purpose: AssetPurpose }[] {
  if (!Array.isArray(fields)) return [];
  const found: { assetId: string; purpose: AssetPurpose }[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    if (!isPlainObject(field)) continue;
    const type = field.type;
    const purpose: AssetPurpose = type === "file" ? "portfolio-media" : "portfolio-image";
    const val = field.value;
    if (!val) continue;

    if ((type === "image" || type === "file") && isPlainObject(val)) {
      const assetId = typeof val.assetId === "string" ? val.assetId.trim() : "";
      if (assetId && !seen.has(assetId)) {
        seen.add(assetId);
        found.push({ assetId, purpose });
      }
    } else if (type === "gallery" && Array.isArray(val)) {
      for (const item of val) {
        if (isPlainObject(item)) {
          const assetId = typeof item.assetId === "string" ? item.assetId.trim() : "";
          if (assetId && !seen.has(assetId)) {
            seen.add(assetId);
            found.push({ assetId, purpose: "portfolio-image" });
          }
        }
      }
    }
  }

  return found;
}
