import { z, type ZodError } from "zod";

const MAX_URL_LENGTH = 2048;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const submitCertificateBodySchema = z.strictObject({
  url: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? "url is required."
          : "url must be a string.",
    })
    .trim()
    .min(1, "url is required.")
    .max(MAX_URL_LENGTH, "url must be at most 2048 characters.")
    .refine(isAbsoluteHttpUrl, "url must be an absolute http or https URL."),
});

export const certificateIdSchema = z.strictObject({
  id: z.uuid("id must be a UUID."),
});

export const verifyCertificateBodySchema = z.strictObject({
  earnerEmail: z
    .string()
    .trim()
    .min(3, "earnerEmail must be an email address.")
    .max(254, "earnerEmail must be at most 254 characters.")
    .regex(/^[^@\s]+@[^@\s]+$/, "earnerEmail must be an email address.")
    .optional(),
});

export const emptyQuerySchema = z.strictObject({});

export interface FieldError {
  path: string;
  message: string;
}

export function fieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => {
    const keys =
      "keys" in issue && Array.isArray(issue.keys)
        ? issue.keys.filter((key): key is string => typeof key === "string")
        : [];
    const path =
      issue.path.length > 0
        ? issue.path.join(".")
        : keys.length > 0
          ? keys.join(", ")
          : "(root)";

    return { path, message: issue.message };
  });
}
