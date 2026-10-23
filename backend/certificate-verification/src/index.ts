import { createCredlyAdapter } from "./adapters/credly-adapter.js";
import { createApp } from "./app.js";
import { loadServiceTokenFromEnvFile } from "./config/load-env-file.js";
import { requireMongoUri } from "./db/database-config.js";
import { connectCertificateDatabase } from "./db/mongo-certificate-repository.js";
import { createGuardedIssuerTransport } from "./http/guarded-issuer-transport.js";

const loadedToken = loadServiceTokenFromEnvFile();

const port = Number(process.env.PORT) || 3000;

// #region agent log
fetch("http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"20b1df"},body:JSON.stringify({sessionId:"20b1df",runId:"pre-fix",hypothesisId:"C",location:"certificate-verification/src/index.ts:boot",message:"certificate service process started",data:{port,mongoConfigured:Boolean(process.env.MONGODB_URI?.trim()),tokenLoaded:loadedToken.tokenPresent,envFileLoaded:loadedToken.loaded},timestamp:Date.now()})}).catch(()=>{});
// #endregion

async function main(): Promise<void> {
  let mongoUri: string;
  try {
    mongoUri = requireMongoUri(process.env);
  } catch (error) {
    // #region agent log
    await fetch("http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"20b1df"},body:JSON.stringify({sessionId:"20b1df",runId:"pre-fix",hypothesisId:"C",location:"certificate-verification/src/index.ts:mongo-config",message:"certificate database setting missing at startup",data:{mongoConfigured:Boolean(process.env.MONGODB_URI?.trim()),portFromEnv:process.env.PORT??""},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    await fetch("http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"20b1df"},body:JSON.stringify({sessionId:"20b1df",runId:"pre-fix",hypothesisId:"C",location:"certificate-verification/src/index.ts:mongo-connect",message:"certificate database connection failed",data:{errorName:error instanceof Error?error.name:"unknown"},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch("http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"20b1df"},body:JSON.stringify({sessionId:"20b1df",runId:"pre-fix",hypothesisId:"A",location:"certificate-verification/src/index.ts:listen",message:"certificate service listening",data:{port},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  });

  const shutdown = (): void => {
    server.close();
    void connected.client.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main();
