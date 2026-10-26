import { createHmac, timingSafeEqual } from "crypto";
import { resolveJwtSecret } from "../auth";
import { isAssetId } from "./keys";

const PUBLIC_ASSET_PATH = /^\/api\/assets\/public\/(ast_[a-f0-9]{24})$/;
const PREVIEW_ASSET_PATH =
  /^\/api\/assets\/private\/(ast_[a-f0-9]{24})\?exp=(\d{1,12})&sig=([a-f0-9]{64})$/;

const PREVIEW_TTL_SECONDS = 10 * 60;

export function publicAssetPath(assetId: string): string {
  if (!isAssetId(assetId)) {
    throw new Error("Invalid asset id.");
  }
  return `/api/assets/public/${assetId}`;
}

export function previewAssetPath(assetId: string, ownerId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!isAssetId(assetId)) {
    throw new Error("Invalid asset id.");
  }
  const owner = String(ownerId || "");
  if (!/^[a-f0-9]{24}$/i.test(owner)) {
    throw new Error("Invalid owner id.");
  }
  const exp = nowSeconds + PREVIEW_TTL_SECONDS;
  const sig = signPreview(assetId, owner, exp);
  return `/api/assets/private/${assetId}?exp=${exp}&sig=${sig}`;
}

export function deliveryPath(
  assetId: string,
  ownerId: string,
  mode: "publish" | "preview"
): string {
  if (mode === "preview") return previewAssetPath(assetId, ownerId);
  return publicAssetPath(assetId);
}

export function signPreview(assetId: string, ownerId: string, exp: number): string {
  return createHmac("sha256", resolveJwtSecret())
    .update(`${assetId}.${ownerId}.${exp}`)
    .digest("hex");
}

export function verifyPreviewSignature(
  assetId: string,
  ownerId: string,
  exp: string,
  signature: string
): boolean {
  if (!isAssetId(assetId) || !/^[a-f0-9]{24}$/i.test(ownerId)) return false;
  if (!/^\d{1,12}$/.test(exp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = signPreview(assetId, ownerId, expNum);
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parsePublicAssetPath(value: string): string | null {
  const match = PUBLIC_ASSET_PATH.exec(value);
  return match ? match[1] : null;
}

export function isAllowedDeliveryUrl(value: string): boolean {
  return PUBLIC_ASSET_PATH.test(value) || PREVIEW_ASSET_PATH.test(value);
}

export function collectPublicAssetIds(value: unknown): string[] {
  const found = new Set<string>();
  const text = JSON.stringify(value ?? null);
  const pattern = /\/api\/assets\/public\/(ast_[a-f0-9]{24})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    found.add(match[1]);
  }
  return [...found];
}
