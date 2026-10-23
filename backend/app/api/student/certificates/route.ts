import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import { submitStudentCertificate } from "../../../../lib/student-certificates";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const response = await submitStudentCertificate(req);
  // #region agent log
  fetch("http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"20b1df"},body:JSON.stringify({sessionId:"20b1df",runId:"post-fix",hypothesisId:"E",location:"certificates/route.ts:POST",message:"platform certificate submit finished",data:{status:response.status},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return applyCorsHeaders(response, req.headers.get("origin"));
}
