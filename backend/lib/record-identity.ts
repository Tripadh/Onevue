import { createHash } from "crypto";

const INDEX_DERIVED_ID = /^[a-z][a-z0-9]*_\d+$/i;
const IDENTITY_EXCLUDED_KEYS = new Set([
  "_id",
  "id",
  "__v",
  "customFields",
  "uploadedAt",
  "createdAt",
  "updatedAt",
]);

/** True for positional ids such as `proj_0` that older readers emitted. */
export function isIndexDerivedRecordId(value: unknown): boolean {
  return typeof value === "string" && INDEX_DERIVED_ID.test(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      if (record[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

function identityMaterial(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const source = record as Record<string, unknown>;
  const material: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (IDENTITY_EXCLUDED_KEYS.has(key)) continue;
    material[key] = source[key];
  }
  return material;
}

/**
 * Deterministic id for a record that has no stored id. Keyed on the record's
 * content so that reordering legacy rows does not move their public identity.
 */
export function contentDerivedRecordId(prefix: string, record: unknown): string {
  const digest = createHash("sha1").update(canonicalJson(identityMaterial(record))).digest("hex");
  return `${prefix}_${digest.slice(0, 16)}`;
}

/** Allocates ids for one list, disambiguating identical legacy records. */
export function recordIdAllocator(prefix: string): (record: unknown) => string {
  const occurrences = new Map<string, number>();
  return (record: unknown) => {
    const base = contentDerivedRecordId(prefix, record);
    const seen = occurrences.get(base) || 0;
    occurrences.set(base, seen + 1);
    return seen === 0 ? base : `${base}_${seen + 1}`;
  };
}
