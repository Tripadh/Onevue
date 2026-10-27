const MISSING_MONGODB_URI =
  "MONGODB_URI is required. certificate-verification will not start with in-memory storage.";

export function requireMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.MONGODB_URI;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(MISSING_MONGODB_URI);
  }

  return value.trim();
}

export function assertTestMongoUri(uri: string): void {
  let database: string;
  try {
    database = new URL(uri).pathname.replace(/^\//, "").split("/")[0] ?? "";
  } catch {
    throw new Error(
      'CERTIFICATE_TEST_MONGODB_URI must be a MongoDB URI whose database name contains "test".',
    );
  }

  if (!database.toLowerCase().includes("test")) {
    throw new Error(
      'CERTIFICATE_TEST_MONGODB_URI must use a database whose name contains "test".',
    );
  }
}
