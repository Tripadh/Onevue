const MISSING_DATABASE_URL =
  "DATABASE_URL is required. certificate-verification will not start with in-memory storage.";

export function requireDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env.DATABASE_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(MISSING_DATABASE_URL);
  }

  return value.trim();
}

export function assertTestDatabaseUrl(url: string): void {
  let database: string;
  try {
    database = new URL(url).pathname.replace(/^\//, "").split("/")[0] ?? "";
  } catch {
    throw new Error(
      'CERTIFICATE_TEST_DATABASE_URL must be a postgres URL whose database name contains "test".',
    );
  }

  if (!database.toLowerCase().includes("test")) {
    throw new Error(
      'CERTIFICATE_TEST_DATABASE_URL must use a database whose name contains "test".',
    );
  }
}
