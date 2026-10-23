import type { RequestHandler } from "express";
import type { ZodError } from "zod";
import { HttpError } from "./error-response.js";
import {
  emptyQuerySchema,
  fieldErrors,
} from "../validation/certificate-input.js";

function validationFailure(error: ZodError): HttpError {
  return new HttpError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed.",
    fieldErrors(error),
  );
}

export const rejectUnexpectedQuery: RequestHandler = (req, _res, next) => {
  const query = req.query;
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    next(new HttpError(400, "VALIDATION_ERROR", "Request validation failed."));
    return;
  }

  const parsed = emptyQuerySchema.safeParse(query);
  if (!parsed.success) {
    next(validationFailure(parsed.error));
    return;
  }

  next();
};
