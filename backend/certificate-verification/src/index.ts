import { createApp } from "./app.js";
import { requireDatabaseUrl } from "./db/database-config.js";
import {
  PostgresCertificateRepository,
  createPrismaClient,
} from "./db/postgres-certificate-repository.js";

const port = Number(process.env.PORT) || 3000;

async function main(): Promise<void> {
  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl(process.env);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Database configuration is missing.",
    );
    process.exit(1);
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    await prisma.$connect();
  } catch {
    console.error("Could not connect to the certificate database.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const app = createApp(new PostgresCertificateRepository(prisma));
  const server = app.listen(port, () => {
    console.log(`certificate-verification listening on port ${port}`);
  });

  const shutdown = (): void => {
    server.close();
    void prisma.$disconnect();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main();
