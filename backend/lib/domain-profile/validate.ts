import { Types } from "mongoose";
import type {
  CollectionField,
  DomainContract,
  FieldSpec,
  ManagedField,
  ObjectField,
  RuleName,
  ScalarField,
} from "./types";

export class ProfileValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProfileValidationError";
    this.status = status;
  }
}

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNoOperators(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoOperators(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (!isPlainObject(value)) {
    throw new ProfileValidationError(`Field '${path || "body"}' must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".") || BLOCKED_KEYS.has(key)) {
      throw new ProfileValidationError(`Unsupported field '${key}'.`);
    }
    assertNoOperators(value[key], path ? `${path}.${key}` : key);
  }
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

function asTrimmedString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ProfileValidationError(`Field '${path}' must be a string.`);
  }
  return value.trim();
}

function sanitizeScalar(spec: ScalarField, value: unknown, path: string): unknown {
  switch (spec.kind) {
    case "string": {
      const trimmed = asTrimmedString(value, path);
      if (spec.required && !trimmed) {
        throw new ProfileValidationError(`Field '${path}' is required.`);
      }
      if (trimmed.length > spec.max) {
        throw new ProfileValidationError(`Field '${path}' cannot exceed ${spec.max} characters.`);
      }
      return trimmed;
    }
    case "enum": {
      const trimmed = asTrimmedString(value, path);
      if (!trimmed && spec.allowEmpty) return "";
      if (!trimmed && spec.required) {
        throw new ProfileValidationError(`Field '${path}' is required.`);
      }
      if (trimmed && !spec.values.includes(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' has an invalid value '${trimmed}'.`);
      }
      if (!trimmed && !spec.allowEmpty) {
        throw new ProfileValidationError(`Field '${path}' has an invalid value.`);
      }
      return trimmed;
    }
    case "url": {
      const trimmed = asTrimmedString(value, path);
      const max = spec.max ?? 500;
      if (!trimmed) {
        if (spec.required) throw new ProfileValidationError(`Field '${path}' is required.`);
        return "";
      }
      if (trimmed.length > max) {
        throw new ProfileValidationError(`Field '${path}' cannot exceed ${max} characters.`);
      }
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new ProfileValidationError(`Field '${path}' must be an http or https URL.`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ProfileValidationError(`Field '${path}' must be an http or https URL.`);
      }
      return trimmed;
    }
    case "email": {
      const trimmed = asTrimmedString(value, path);
      const max = spec.max ?? 200;
      if (!trimmed) {
        if (spec.required) throw new ProfileValidationError(`Field '${path}' is required.`);
        return "";
      }
      if (trimmed.length > max || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' must be a valid email address.`);
      }
      return trimmed;
    }
    case "phone": {
      const trimmed = asTrimmedString(value, path);
      const max = spec.max ?? 30;
      if (!trimmed) return "";
      if (trimmed.length > max || !/^[0-9+().\-\s]{3,30}$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' must be a valid phone number.`);
      }
      return trimmed;
    }
    case "date": {
      const trimmed = asTrimmedString(value, path);
      if (!trimmed) {
        if (spec.required) throw new ProfileValidationError(`Field '${path}' is required.`);
        return "";
      }
      if (!isIsoDate(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' must be a valid date in YYYY-MM-DD format.`);
      }
      return trimmed;
    }
    case "hex": {
      const trimmed = asTrimmedString(value, path);
      if (!trimmed) return "";
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' must be a hex color.`);
      }
      return trimmed;
    }
    case "storageKey": {
      const trimmed = asTrimmedString(value, path);
      if (!trimmed) return "";
      if (trimmed.length > 300 || trimmed.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' is not a valid storage reference.`);
      }
      return trimmed;
    }
    case "assetId": {
      const trimmed = asTrimmedString(value, path);
      if (!trimmed) return "";
      if (!/^ast_[a-f0-9]{24}$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' is not a valid asset reference.`);
      }
      return trimmed;
    }
    case "currency": {
      const trimmed = asTrimmedString(value, path).toUpperCase();
      if (!trimmed) return "";
      if (!/^[A-Z]{3,8}$/.test(trimmed)) {
        throw new ProfileValidationError(`Field '${path}' must be a 3 to 8 letter currency code.`);
      }
      return trimmed;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ProfileValidationError(`Field '${path}' must be a number.`);
      }
      if (spec.integer && !Number.isInteger(value)) {
        throw new ProfileValidationError(`Field '${path}' must be a whole number.`);
      }
      if (value < spec.min || value > spec.max) {
        throw new ProfileValidationError(
          `Field '${path}' must be between ${spec.min} and ${spec.max}.`
        );
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new ProfileValidationError(`Field '${path}' must be true or false.`);
      }
      return value;
    }
    case "year": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new ProfileValidationError(`Field '${path}' must be a whole year.`);
      }
      const maxYear = new Date().getUTCFullYear();
      if (value < spec.min || value > maxYear) {
        throw new ProfileValidationError(`Field '${path}' must be between ${spec.min} and ${maxYear}.`);
      }
      return value;
    }
    case "stringList": {
      if (!Array.isArray(value)) {
        throw new ProfileValidationError(`Field '${path}' must be an array of strings.`);
      }
      if (value.length > spec.maxItems) {
        throw new ProfileValidationError(`Field '${path}' cannot exceed ${spec.maxItems} items.`);
      }
      const items: string[] = [];
      value.forEach((entry, index) => {
        if (typeof entry !== "string") {
          throw new ProfileValidationError(`Field '${path}[${index}]' must be a string.`);
        }
        const trimmed = entry.trim();
        if (!trimmed) return;
        if (trimmed.length > spec.itemMax) {
          throw new ProfileValidationError(
            `Field '${path}[${index}]' cannot exceed ${spec.itemMax} characters.`
          );
        }
        if (spec.enumValues && !spec.enumValues.includes(trimmed)) {
          throw new ProfileValidationError(`Field '${path}[${index}]' has an invalid value '${trimmed}'.`);
        }
        items.push(trimmed);
      });
      return items;
    }
    default:
      throw new ProfileValidationError(`Field '${path}' is not supported.`);
  }
}

function emptyScalar(spec: ScalarField): unknown {
  if ("defaultValue" in spec && spec.defaultValue !== undefined) return spec.defaultValue;
  switch (spec.kind) {
    case "string":
    case "url":
    case "email":
    case "phone":
    case "date":
    case "hex":
    case "storageKey":
    case "assetId":
    case "currency":
      return "";
    case "enum":
      return spec.allowEmpty ? "" : (spec.defaultValue ?? spec.values[0] ?? "");
    case "number":
      return spec.defaultValue ?? 0;
    case "year":
      return "";
    case "boolean":
      return spec.defaultValue ?? false;
    case "stringList":
      return [];
    default:
      return "";
  }
}

function enforceRules(rules: RuleName[] | undefined, record: Record<string, unknown>, path: string) {
  if (!rules || rules.length === 0) return;
  if (rules.includes("dateOrder")) {
    const start = typeof record.startDate === "string" ? record.startDate : "";
    const end = typeof record.endDate === "string" ? record.endDate : "";
    if (start && end && end < start) {
      throw new ProfileValidationError(`Field '${path}.endDate' cannot be earlier than startDate.`);
    }
  }
  if (rules.includes("rateOrder")) {
    const min = record.rateMin;
    const max = record.rateMax;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      throw new ProfileValidationError(`Field '${path}.rateMin' cannot exceed rateMax.`);
    }
  }
  if (rules.includes("engagementRate")) {
    if (record.metric === "engagement_rate" && typeof record.value === "number" && record.value > 100) {
      throw new ProfileValidationError(`Field '${path}.value' cannot exceed 100 for engagement_rate.`);
    }
  }
  if (rules.includes("expiryOrder")) {
    const issued = typeof record.issueDate === "string" ? record.issueDate : "";
    const expires = typeof record.expirationDate === "string" ? record.expirationDate : "";
    if (issued && expires && expires < issued) {
      throw new ProfileValidationError(`Field '${path}.expirationDate' cannot be earlier than issueDate.`);
    }
  }
  if (rules.includes("priceCurrency")) {
    const price = record.price;
    const currency = typeof record.currency === "string" ? record.currency.trim() : "";
    if (typeof price === "number" && !currency) {
      throw new ProfileValidationError(`Field '${path}.currency' is required when a price is set.`);
    }
  }
  if (rules.includes("currentEnd")) {
    if (record.isCurrent === true && typeof record.endDate === "string" && record.endDate) {
      throw new ProfileValidationError(`Field '${path}.endDate' cannot be set on a current role.`);
    }
  }
}

function resolveManaged(rule: ManagedField, incoming: unknown, previous: unknown, path: string): string {
  const current = typeof previous === "string" && previous ? previous : rule.defaultValue;
  if (typeof incoming !== "string") {
    throw new ProfileValidationError(`Field '${path}' must be a string.`);
  }
  const trimmed = incoming.trim();
  if (trimmed === current) return current;
  if (current === "verified" || current === "rejected") {
    throw new ProfileValidationError(`Field '${path}' is controlled by the server.`);
  }
  if (!rule.allowed.includes(trimmed)) {
    throw new ProfileValidationError(`Field '${path}' cannot be set to '${trimmed}'.`);
  }
  return trimmed;
}

function applyObject(
  existing: Record<string, unknown> | undefined,
  input: unknown,
  spec: ObjectField,
  prefix: string,
  set: Record<string, unknown>,
  path: string
) {
  if (!isPlainObject(input)) {
    throw new ProfileValidationError(`Field '${path}' must be an object.`);
  }
  const managed = new Map((spec.managed || []).map((rule) => [rule.key, rule]));
  for (const key of Object.keys(input)) {
    if (!spec.fields[key] && !managed.has(key)) {
      throw new ProfileValidationError(`Unsupported field '${path}.${key}'.`);
    }
  }

  const picture: Record<string, unknown> = { ...(existing || {}) };

  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if (fieldSpec.kind === "object") {
      applyObject(
        (existing?.[key] as Record<string, unknown>) || {},
        input[key],
        fieldSpec,
        `${prefix}${key}.`,
        set,
        `${path}.${key}`
      );
      continue;
    }
    const value = sanitizeScalar(fieldSpec, input[key], `${path}.${key}`);
    picture[key] = value;
    set[`${prefix}${key}`] = value;
  }

  for (const [key, rule] of managed) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const resolved = resolveManaged(rule, input[key], existing?.[key], `${path}.${key}`);
    picture[key] = resolved;
    set[`${prefix}${key}`] = resolved;
  }

  enforceRules(spec.rules, picture, path);
  if (spec.rules?.includes("touchUploadedAt") && Object.prototype.hasOwnProperty.call(input, "storageKey")) {
    set[`${prefix}uploadedAt`] = input.storageKey ? new Date() : null;
  }
}

function applyCollection(
  existingList: unknown,
  input: unknown,
  spec: CollectionField,
  path: string
): Record<string, unknown>[] {
  if (!Array.isArray(input)) {
    throw new ProfileValidationError(`Field '${path}' must be an array.`);
  }
  if (input.length > spec.maxItems) {
    throw new ProfileValidationError(`Field '${path}' cannot exceed ${spec.maxItems} items.`);
  }
  const existingItems = Array.isArray(existingList) ? existingList : [];
  const managed = new Map((spec.managed || []).map((rule) => [rule.key, rule]));
  const seen = new Set<string>();
  const stored: Record<string, unknown>[] = [];

  input.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      throw new ProfileValidationError(`Field '${itemPath}' must be an object.`);
    }
    for (const key of Object.keys(item)) {
      if (key === "id") continue;
      if (!spec.fields[key] && !managed.has(key)) {
        throw new ProfileValidationError(`Unsupported field '${itemPath}.${key}'.`);
      }
    }

    let incomingId = "";
    if (Object.prototype.hasOwnProperty.call(item, "id") && item.id !== undefined && item.id !== null && item.id !== "") {
      if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id)) {
        throw new ProfileValidationError(`Field '${itemPath}.id' is invalid.`);
      }
      incomingId = item.id;
    }

    const existing = incomingId
      ? existingItems.find((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const row = entry as Record<string, unknown>;
          return String(row.id || "") === incomingId || String(row._id || "") === incomingId;
        }) as Record<string, unknown> | undefined
      : undefined;

    const objectId = existing?._id ? existing._id : new Types.ObjectId();
    const id = incomingId || (existing?.id ? String(existing.id) : String(objectId));
    if (seen.has(id)) {
      throw new ProfileValidationError(`Field '${itemPath}.id' duplicates another record.`);
    }
    seen.add(id);

    const record: Record<string, unknown> = { _id: objectId, id };

    for (const [key, fieldSpec] of Object.entries(spec.fields)) {
      const present = Object.prototype.hasOwnProperty.call(item, key) && item[key] !== undefined;
      if (fieldSpec.kind === "collection") {
        if (!present) {
          record[key] = existing && Array.isArray(existing[key]) ? existing[key] : [];
          continue;
        }
        record[key] = applyCollection(existing?.[key], item[key], fieldSpec, `${itemPath}.${key}`);
        continue;
      }
      if (!present) {
        if (existing && existing[key] !== undefined && existing[key] !== null) {
          record[key] = existing[key];
          continue;
        }
        if ("defaultValue" in fieldSpec && fieldSpec.defaultValue !== undefined) {
          record[key] = fieldSpec.defaultValue;
          continue;
        }
        if ("required" in fieldSpec && fieldSpec.required) {
          throw new ProfileValidationError(`Field '${itemPath}.${key}' is required.`);
        }
        if (fieldSpec.kind === "number" || fieldSpec.kind === "year") continue;
        record[key] = emptyScalar(fieldSpec);
        continue;
      }
      record[key] = sanitizeScalar(fieldSpec, item[key], `${itemPath}.${key}`);
    }

    for (const [key, rule] of managed) {
      if (!Object.prototype.hasOwnProperty.call(item, key) || item[key] === undefined) {
        record[key] = typeof existing?.[key] === "string" && existing[key] ? existing[key] : rule.defaultValue;
        continue;
      }
      record[key] = resolveManaged(rule, item[key], existing?.[key], `${itemPath}.${key}`);
    }

    enforceRules(spec.rules, record, itemPath);
    stored.push(record);
  });

  return stored;
}

export function buildDomainUpdate(
  existing: Record<string, unknown>,
  body: unknown,
  contract: DomainContract,
  ownerId: unknown
): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new ProfileValidationError("Request body must be an object.");
  }
  assertNoOperators(body, "");

  if (Object.prototype.hasOwnProperty.call(body, "userId")) {
    if (String(body.userId) !== String(ownerId)) {
      throw new ProfileValidationError("Unauthorized attempt to modify profile ownership.", 403);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "ownerId")) {
    throw new ProfileValidationError("Unauthorized attempt to modify profile ownership.", 403);
  }
  if (Object.prototype.hasOwnProperty.call(body, "identity")) {
    const requested = String(body.identity || "").trim().toLowerCase();
    if (requested !== contract.identity) {
      throw new ProfileValidationError(`Invalid identity '${requested || "unset"}'.`);
    }
  }

  const set: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key === "userId" || key === "identity") continue;
    const spec: FieldSpec | undefined = contract.fields[key];
    if (!spec) {
      throw new ProfileValidationError(`Unsupported field '${key}'.`);
    }
    if (spec.kind === "object") {
      applyObject((existing[key] as Record<string, unknown>) || {}, body[key], spec, `${key}.`, set, key);
      continue;
    }
    if (spec.kind === "collection") {
      set[key] = applyCollection(existing[key], body[key], spec, key);
      continue;
    }
    set[key] = sanitizeScalar(spec, body[key], key);
  }
  return set;
}
