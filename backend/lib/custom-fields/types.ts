/**
 * Shared custom-field contract. Definitions, values, and published snapshots
 * use this shape for every identity. Templates do not own the data.
 */

export const CUSTOM_LAYOUT_SCHEMA_VERSION = 1 as const;

export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "heading",
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

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomIdentity = "student" | "professional" | "freelancer" | "creator" | "business";

export const CUSTOM_FIELD_LIMITS = {
  maxSections: 24,
  maxFieldsPerSection: 30,
  maxEntriesPerSection: 40,
  maxBindings: 400,
  maxLabel: 80,
  maxHelp: 240,
  maxPlaceholder: 120,
  maxDescription: 300,
  maxKey: 40,
  maxOptions: 30,
  maxOptionLabel: 80,
  textMax: 500,
  textareaMax: 4000,
  tagsMax: 20,
  tagLength: 40,
  galleryMax: 8,
  payloadChars: 180_000,
  fileNameMax: 120,
  imageMaxBytes: 5 * 1024 * 1024,
  fileMaxBytes: 8 * 1024 * 1024,
} as const;

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const FILE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export interface SelectOption {
  value: string;
  label: string;
}

/** Type-specific settings. Unused keys are removed during validation. */
export interface CustomFieldConfig {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: SelectOption[];
  maxSelections?: number;
  maxItems?: number;
  itemMaxLength?: number;
  accept?: string[];
  maxBytes?: number;
}

/** section: the field belongs to the whole section. record: one existing identity record. */
export type AttachmentScope = "section" | "record";

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  visibility: "public" | "private";
  order: number;
  helpText: string;
  placeholder: string;
  retired: boolean;
  config: CustomFieldConfig;
  createdAt: string;
  updatedAt: string;
  /** Missing on older layouts. Readers treat that as a section field. */
  scope: AttachmentScope;
  /** Stable identity-record id when scope is "record". Empty otherwise. */
  targetRecordId: string;
  /** Built-in field key this value may fill when the types match. Empty when unmapped. */
  mapsTo: string;
}

export interface AssetFieldValue {
  assetId: string;
  fileName: string;
}

export interface VideoFieldValue {
  kind: "url";
  url: string;
}

export type CustomFieldValue =
  | string
  | number
  | boolean
  | string[]
  | AssetFieldValue
  | AssetFieldValue[]
  | VideoFieldValue
  | null;

export interface CustomBinding {
  sectionId: string;
  recordId: string;
  values: Record<string, CustomFieldValue>;
}

export interface CustomEntry {
  id: string;
  sectionId: string;
  order: number;
  values: Record<string, CustomFieldValue>;
}

export interface CustomSection {
  id: string;
  key: string;
  title: string;
  description: string;
  /** Null for a section the user created. Otherwise a stable built-in section key. */
  builtinKey: string | null;
  visibility: "public" | "private";
  order: number;
  repeatable: boolean;
  hidden: boolean;
  fields: CustomFieldDefinition[];
}

export interface CustomLayout {
  schemaVersion: typeof CUSTOM_LAYOUT_SCHEMA_VERSION;
  revision: number;
  sections: CustomSection[];
  bindings: CustomBinding[];
  entries: CustomEntry[];
}

export type CustomPresentation =
  | "heading"
  | "inline"
  | "detail"
  | "link"
  | "image"
  | "gallery"
  | "video"
  | "file"
  | "tags"
  | "number"
  | "boolean"
  | "hidden";

export interface PublicCustomField {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  order: number;
  helpText?: string;
  presentation: CustomPresentation;
  value: PublicCustomValue;
  /** Set when this value is allowed to fill an empty built-in field. */
  mapsTo?: string;
}

export type PublicCustomValue =
  | string
  | number
  | boolean
  | string[]
  | { href: string; fileName?: string }
  | { href: string; fileName?: string }[]
  | { href: string; embed: boolean };

export interface PublicCustomRecord {
  id: string;
  fields: PublicCustomField[];
}

export interface PublicCustomSection {
  id: string;
  key: string;
  title: string;
  description?: string;
  builtinKey?: string;
  order: number;
  repeatable: boolean;
  records: PublicCustomRecord[];
}

export function emptyCustomLayout(): CustomLayout {
  return {
    schemaVersion: CUSTOM_LAYOUT_SCHEMA_VERSION,
    revision: 0,
    sections: [],
    bindings: [],
    entries: [],
  };
}

export interface RecordCustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  visibility: "public" | "private";
  order: number;
  value: unknown;
}
