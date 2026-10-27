export {
  BUILTIN_SECTIONS,
  builtinByKey,
  builtinSections,
  isCustomIdentity,
  patchTouchesBuiltinRecords,
  recordIdsForIdentity,
} from "./builtins";
export { fieldCompatibility, presentationForField, templateSupportsField, MAGICUI_TEMPLATE_ID } from "./capabilities";
export { projectCustomLayout, sanitizePublicCustomSections } from "./publish";
export {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_LAYOUT_SCHEMA_VERSION,
  emptyCustomLayout,
} from "./types";
export type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomIdentity,
  CustomLayout,
  PublicCustomField,
  PublicCustomSection,
} from "./types";
export { collectCustomAssetBindings, normalizeCustomLayout, syncCustomLayout, videoEmbedAllowed } from "./validate";
