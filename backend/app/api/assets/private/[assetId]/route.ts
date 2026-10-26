import { verifyAuth } from "../../../../../lib/auth";
import connectToDatabase from "../../../../../lib/db";
import StoredAsset from "../../../../../models/StoredAsset";
import { readOwnedAsset } from "../../../../../lib/storage/asset-service";
import { verifyPreviewSignature } from "../../../../../lib/storage/asset-refs";
import { isPublicEligible } from "../../../../../lib/storage/purposes";
import { assetBytes, assetError, assetJson, assetOptions } from "../../../../../lib/storage/http";
import { isAssetId } from "../../../../../lib/storage/keys";

export function OPTIONS(req: Request) {
  return assetOptions(req);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ assetId: string }> | { assetId: string } }
) {
  try {
    const params = await context.params;
    const assetId = typeof params?.assetId === "string" ? params.assetId : "";
    if (!isAssetId(assetId)) return assetJson(req, { message: "Invalid asset identifier." }, 400);

    const auth = await verifyAuth(req);
    if (!("error" in auth)) {
      const owned = await readOwnedAsset(String(auth.user._id), assetId);
      if (!owned) return assetJson(req, { message: "Asset not found." }, 404);
      return assetBytes(req, owned.body, owned.contentType, owned.asset.fileName, "private");
    }

    const url = new URL(req.url);
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";
    if (!exp || !sig) return assetJson(req, { message: auth.error }, auth.status);

    await connectToDatabase();
    const Model = (StoredAsset as { default?: typeof StoredAsset }).default || StoredAsset;
    const asset = await Model.findOne({ assetId, status: "verified" });
    if (!asset || !isPublicEligible(asset.purpose)) {
      return assetJson(req, { message: "Asset not found." }, 404);
    }
    if (!verifyPreviewSignature(assetId, String(asset.ownerId), exp, sig)) {
      return assetJson(req, { message: "Asset not found." }, 404);
    }
    const owned = await readOwnedAsset(String(asset.ownerId), assetId);
    if (!owned) return assetJson(req, { message: "Asset not found." }, 404);
    return assetBytes(req, owned.body, owned.contentType, owned.asset.fileName, "private");
  } catch (error) {
    return assetError(req, error);
  }
}
