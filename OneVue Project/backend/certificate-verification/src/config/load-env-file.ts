import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN_KEY = "CERTIFICATE_SERVICE_TOKEN";

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

  let fileValue = "";
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || !line.startsWith(`${TOKEN_KEY}=`)) {
      continue;
    }
    fileValue = line.slice(TOKEN_KEY.length + 1).trim();
    if (
      (fileValue.startsWith('"') && fileValue.endsWith('"')) ||
      (fileValue.startsWith("'") && fileValue.endsWith("'"))
    ) {
      fileValue = fileValue.slice(1, -1);
    }
  }

  if (fileValue.length > 0) {
    env[TOKEN_KEY] = fileValue;
  }
  const current = env[TOKEN_KEY]?.trim() ?? "";
  return {
    loaded: true,
    tokenPresent: current.length > 0,
    tokenLength: current.length,
  };
}
