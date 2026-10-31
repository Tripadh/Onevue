import { validateJwtConfiguration } from "./lib/auth";

export function register() {
  if (process.env.NODE_ENV === "production") {
    validateJwtConfiguration();
  }
}
