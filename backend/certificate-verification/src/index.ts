import { createCredlyAdapter } from "./adapters/credly-adapter.js";
import { createApp } from "./app.js";
import { loadServiceTokenFromEnvFile } from "./config/load-env-file.js";
import { requireMongoUri } from "./db/database-config.js";
import { connectCertificateDatabase } from "./db/mongo-certificate-repository.js";
import { createGuardedIssuerTransport } from "./http/guarded-issuer-transport.js";

loadServiceTokenFromEnvFile();

const port = Number(process.env.PORT) || 3000;

async function main(): Promise<void> {
  let mongoUri: string;
  try {
    mongoUri = requireMongoUri(process.env);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Database configuration is missing.",
    );
    process.exit(1);
  }

  let connected: Awaited<ReturnType<typeof connectCertificateDatabase>>;
  try {
    connected = await connectCertificateDatabase(mongoUri);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Could not connect to the certificate database.",
    );
    process.exit(1);
  }

  const app = createApp(
    connected.repository,
    createCredlyAdapter({
      permitOutbound: true,
      transport: createGuardedIssuerTransport(),
      log: true,
    }),
  );
  const server = app.listen(port, () => {
    console.log(`certificate-verification listening on port ${port}`);
  });

  const shutdown = (): void => {
    server.close();
    void connected.client.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main();
