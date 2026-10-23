import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_KEY = "CERTIFICATE_SERVICE_TOKEN";
const FILL_IF_BLANK = ["MONGODB_URI", "PORT"] as const;

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function certificateEnvPath(moduleUrl: string = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..", ".env");
}

export function loadServiceTokenFromEnvFile(
  envPath: string = certificateEnvPath(),
  env: NodeJS.ProcessEnv = process.env,
): { loaded: boolean; tokenPresent: boolean; tokenLength: number } {
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    const current = env[TOKEN_KEY]?.trim() ?? "";
    return {
      loaded: false,
      tokenPresent: current.length > 0,
      tokenLength: current.length,
    };
  }

  const fileValues = new Map<string, string>();
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    fileValues.set(line.slice(0, separator), unquote(line.slice(separator + 1).trim()));
  }

  const fileValue = fileValues.get(TOKEN_KEY) ?? "";
  if (fileValue.length > 0) {
    env[TOKEN_KEY] = fileValue;
  }
  for (const key of FILL_IF_BLANK) {
    const current = env[key]?.trim() ?? "";
    const fromFile = fileValues.get(key) ?? "";
    if (current.length === 0 && fromFile.length > 0) {
      env[key] = fromFile;
    }
  }
  const current = env[TOKEN_KEY]?.trim() ?? "";
  return {
    loaded: true,
    tokenPresent: current.length > 0,
    tokenLength: current.length,
  };
}
