import { readPublishedAsset } from "../../../../../lib/storage/asset-service";
import { assetError, assetBytes, assetJson, assetOptions } from "../../../../../lib/storage/http";
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
    const published = await readPublishedAsset(assetId);
    if (!published) return assetJson(req, { message: "Asset not found." }, 404);
    return assetBytes(req, published.body, published.contentType, published.asset.fileName, "public");
  } catch (error) {
    return assetError(req, error);
  }
}
