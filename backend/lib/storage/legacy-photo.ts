import connectToDatabase from "../db";
import User from "../../models/User";
import VisitingCard from "../../models/VisitingCard";
import PublishedProfileRevision from "../../models/PublishedProfileRevision";
import { isLegacyProfilePhotoKey, isPrefixedProfilePhotoKey } from "./keys";

function modelOf<T>(model: T): T {
  if (model && typeof model === "object" && "default" in (model as object)) {
    const wrapped = model as { default?: T };
    if (wrapped.default) return wrapped.default;
  }
  return model;
}

export function isAllowedProfilePhotoKey(key: string): boolean {
  return isLegacyProfilePhotoKey(key) || isPrefixedProfilePhotoKey(key);
}

export async function isServableLegacyPhoto(key: string): Promise<boolean> {
  if (!isAllowedProfilePhotoKey(key)) return false;
  await connectToDatabase();
  const users = modelOf(User);
  const cards = modelOf(VisitingCard);
  const revisions = modelOf(PublishedProfileRevision);
  if (await users.exists({ profilePhotoKey: key })) return true;
  if (await cards.exists({ "assetReferences.key": key })) return true;
  if (await revisions.exists({ legacyPhotoKeys: key })) return true;
  return false;
}

/** Keep a replaced photo file when a card or published revision still needs it. */
export async function legacyPhotoRetained(key: string): Promise<boolean> {
  if (!isAllowedProfilePhotoKey(key)) return false;
  await connectToDatabase();
  const cards = modelOf(VisitingCard);
  const revisions = modelOf(PublishedProfileRevision);
  if (await cards.exists({ "assetReferences.key": key })) return true;
  if (await revisions.exists({ legacyPhotoKeys: key })) return true;
  return false;
}
