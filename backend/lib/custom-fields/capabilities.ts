import { CUSTOM_FIELD_TYPES, type CustomFieldType, type CustomPresentation } from "./types";

/**
 * Template capability contract. Each template names the field types it can
 * present. Unsupported values stay on the profile and in the snapshot; the
 * presentation is "hidden" instead of dropping the stored field.
 *
 * magicui-portfolio is the registered adapter and supports every current type.
 * Another framework consumes this same data contract. It does not import
 * these React components.
 */
export const MAGICUI_TEMPLATE_ID = "magicui-portfolio";

const TEXT_PRESENTATION: Record<CustomFieldType, CustomPresentation> = {
  text: "inline",
  textarea: "detail",
  number: "number",
  url: "link",
  date: "inline",
  boolean: "boolean",
  select: "inline",
  multiselect: "tags",
  tags: "tags",
  image: "image",
  gallery: "gallery",
  video: "video",
  file: "file",
};

const MEDIA_TYPES = new Set<CustomFieldType>(["image", "gallery", "video", "file"]);

export function templateSupportsField(templateId: string, type: CustomFieldType): boolean {
  if (templateId === MAGICUI_TEMPLATE_ID) return true;
  return !MEDIA_TYPES.has(type);
}

export function presentationForField(templateId: string, type: CustomFieldType): CustomPresentation {
  if (!templateSupportsField(templateId, type)) return "hidden";
  return TEXT_PRESENTATION[type];
}

export interface FieldCompatibility {
  state: "supported" | "fallback" | "hidden";
  presentation: CustomPresentation;
  message: string;
}

export function fieldCompatibility(templateId: string, type: CustomFieldType): FieldCompatibility {
  if (!CUSTOM_FIELD_TYPES.includes(type)) {
    return {
      state: "hidden",
      presentation: "hidden",
      message: "This field type is not supported.",
    };
  }
  if (templateId === MAGICUI_TEMPLATE_ID) {
    return {
      state: "supported",
      presentation: TEXT_PRESENTATION[type],
      message: "",
    };
  }
  if (MEDIA_TYPES.has(type)) {
    return {
      state: "hidden",
      presentation: "hidden",
      message: "This template hides this field on the public page. The value stays on your profile.",
    };
  }
  return {
    state: "fallback",
    presentation: TEXT_PRESENTATION[type],
    message: "This template shows the value as plain text.",
  };
}
