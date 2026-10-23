import mongoose from "mongoose";
import UserWebsiteConfig from "../../models/UserWebsiteConfig";
import VisitingCard from "../../models/VisitingCard";
import { AnalyticsResourceType } from "./constants";

export interface AnalyticsResourceRecord {
  resourceId: string;
  ownerId: string;
  resourceType: AnalyticsResourceType;
  displayName: string;
  publicPath: string | null;
  publicationStatus: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

interface WebsiteLean {
  _id?: unknown;
  userId?: unknown;
  username?: string;
  status?: string;
  activeRevisionId?: unknown;
  publishedAt?: Date | null;
  updatedAt?: Date | null;
}

interface CardLean {
  _id?: unknown;
  userId?: unknown;
  username?: string;
  designName?: string;
  publicationStatus?: string;
  publishedSnapshot?: unknown;
  publishedAt?: Date | null;
  updatedAt?: Date | null;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function mapWebsite(site: WebsiteLean): AnalyticsResourceRecord {
  const published = site.status === "published" && site.activeRevisionId;
  return {
    resourceId: asString(site._id),
    ownerId: asString(site.userId),
    resourceType: "portfolio",
    displayName: site.username || "Portfolio",
    publicPath: site.username ? `/p/${site.username}` : null,
    publicationStatus: published ? "published" : site.status || "draft",
    publishedAt: site.publishedAt || null,
    updatedAt: site.updatedAt || null,
  };
}

function mapCard(card: CardLean): AnalyticsResourceRecord {
  const published = card.publicationStatus === "published" && card.publishedSnapshot;
  return {
    resourceId: asString(card._id),
    ownerId: asString(card.userId),
    resourceType: "visiting_card",
    displayName: card.designName || card.username || "Visiting card",
    publicPath: published && card.username ? `/card/${card.username}` : null,
    publicationStatus: published ? "published" : card.publicationStatus || "draft",
    publishedAt: card.publishedAt || null,
    updatedAt: card.updatedAt || null,
  };
}

export async function listOwnedResources(ownerId: unknown): Promise<AnalyticsResourceRecord[]> {
  const [sites, cards] = await Promise.all([
    UserWebsiteConfig.find({ userId: ownerId }).sort({ updatedAt: -1 }).limit(100).lean(),
    VisitingCard.find({ userId: ownerId }).sort({ updatedAt: -1 }).limit(100).lean(),
  ]);
  return [
    ...(sites as WebsiteLean[]).map(mapWebsite),
    ...(cards as CardLean[]).map(mapCard),
  ];
}

export async function findOwnedResource(ownerId: unknown, resourceId: string): Promise<AnalyticsResourceRecord | null> {
  if (!mongoose.Types.ObjectId.isValid(resourceId)) return null;
  const site = await UserWebsiteConfig.findOne({ _id: resourceId, userId: ownerId }).lean();
  if (site) return mapWebsite(site);
  const card = await VisitingCard.findOne({ _id: resourceId, userId: ownerId }).lean();
  if (card) return mapCard(card);
  return null;
}

export async function findPublishedResource(resourceId: unknown, resourceType: unknown): Promise<AnalyticsResourceRecord | null> {
  if (typeof resourceId !== "string" || !mongoose.Types.ObjectId.isValid(resourceId)) return null;
  if (resourceType === "portfolio") {
    const site = await UserWebsiteConfig.findOne({
      _id: resourceId,
      status: "published",
      activeRevisionId: { $ne: null },
    }).lean();
    return site ? mapWebsite(site) : null;
  }
  if (resourceType === "visiting_card") {
    const card = await VisitingCard.findOne({
      _id: resourceId,
      publicationStatus: "published",
      publishedSnapshot: { $ne: null },
    }).lean();
    return card ? mapCard(card) : null;
  }
  return null;
}
