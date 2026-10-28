export {
  BUILTIN_SECTIONS,
  builtinByKey,
  builtinSections,
  isCustomIdentity,
  mappableFields,
  mappingCompatible,
  patchTouchesBuiltinRecords,
  recordIdsForIdentity,
} from "./builtins";
export { fieldCompatibility, presentationForField, templateSupportsField, MAGICUI_TEMPLATE_ID } from "./capabilities";
export {
  applyRecordMappings,
  projectCustomLayout,
  projectRecordFields,
  retainOwnedCustomRecords,
  sanitizePublicCustomSections,
} from "./publish";
export {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_LAYOUT_SCHEMA_VERSION,
  emptyCustomLayout,
} from "./types";
export type {
  AttachmentScope,
  CustomFieldDefinition,
  CustomFieldType,
  CustomIdentity,
  CustomLayout,
  PublicCustomField,
  PublicCustomSection,
  RecordCustomField,
} from "./types";
export { collectCustomAssetBindings, collectRecordCustomFieldAssets, normalizeCustomLayout, syncCustomLayout, validateRecordCustomFields, videoEmbedAllowed } from "./validate";
