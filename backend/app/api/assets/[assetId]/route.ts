import { verifyAuth } from "../../../../lib/auth";
import { deleteOwnedAsset, getOwnedAsset, toAssetMetadata } from "../../../../lib/storage/asset-service";
import { assetError, assetJson, assetOptions } from "../../../../lib/storage/http";
import { isAssetId } from "../../../../lib/storage/keys";

export function OPTIONS(req: Request) {
  return assetOptions(req);
}

async function assetIdFrom(context: { params: Promise<{ assetId: string }> | { assetId: string } }) {
  const params = await context.params;
  return typeof params?.assetId === "string" ? params.assetId : "";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ assetId: string }> | { assetId: string } }
) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) return assetJson(req, { message: auth.error }, auth.status);
    const assetId = await assetIdFrom(context);
    if (!isAssetId(assetId)) return assetJson(req, { message: "Invalid asset identifier." }, 400);
    const asset = await getOwnedAsset(String(auth.user._id), assetId);
    if (!asset) return assetJson(req, { message: "Asset not found." }, 404);
    return assetJson(req, { asset: toAssetMetadata(asset) });
  } catch (error) {
    return assetError(req, error);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ assetId: string }> | { assetId: string } }
) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) return assetJson(req, { message: auth.error }, auth.status);
    const assetId = await assetIdFrom(context);
    if (!isAssetId(assetId)) return assetJson(req, { message: "Invalid asset identifier." }, 400);
    const result = await deleteOwnedAsset(String(auth.user._id), assetId);
    if (result === "missing") return assetJson(req, { message: "Asset not found." }, 404);
    if (result === "in-use") {
      return assetJson(
        req,
        { message: "This file is still used by a profile or a published page. Remove that reference before deleting it." },
        409
      );
    }
    return assetJson(req, { message: "Asset removed." });
  } catch (error) {
    return assetError(req, error);
  }
}
