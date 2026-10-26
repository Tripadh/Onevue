import { verifyAuth } from "../../../lib/auth";
import { assetError, assetJson, assetOptions } from "../../../lib/storage/http";
import { listOwnedAssets, uploadAsset } from "../../../lib/storage/asset-service";
import { PURPOSE_POLICIES, isAssetPurpose } from "../../../lib/storage/purposes";

export function OPTIONS(req: Request) {
  return assetOptions(req);
}

export async function GET(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) return assetJson(req, { message: auth.error }, auth.status);
    const assets = await listOwnedAssets(String(auth.user._id));
    return assetJson(req, { assets });
  } catch (error) {
    return assetError(req, error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) return assetJson(req, { message: auth.error }, auth.status);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return assetJson(req, { message: "Invalid form data. Upload the file as multipart/form-data." }, 400);
    }

    const purpose = String(formData.get("purpose") || "").trim();
    if (!isAssetPurpose(purpose)) {
      return assetJson(req, { message: "Unsupported asset purpose." }, 400);
    }
    const file = formData.get("file") as { size?: number; type?: string; name?: string; arrayBuffer?: () => Promise<ArrayBuffer> } | null;
    if (!file || typeof file.arrayBuffer !== "function") {
      return assetJson(req, { message: "No file provided." }, 400);
    }
    const limit = PURPOSE_POLICIES[purpose].maxBytes;
    if (typeof file.size === "number" && file.size > limit) {
      return assetJson(
        req,
        { message: `File exceeds the ${(limit / (1024 * 1024)).toFixed(0)} MB limit for ${purpose}.` },
        400
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await uploadAsset({
      ownerId: String(auth.user._id),
      purpose,
      buffer,
      clientMimeType: file.type,
      fileName: file.name,
      idempotencyKey: req.headers.get("idempotency-key"),
    });
    return assetJson(req, { message: "Asset uploaded.", asset }, 201);
  } catch (error) {
    return assetError(req, error);
  }
}
