/**
 * Identity-aware sources for the website publishing pipeline and visiting-card seeding.
 *
 * Students publish their StudentProfile unchanged. Professional, freelancer, creator,
 * and business profiles are first passed through the public projection (private
 * contact details, registration numbers, private team members and resources are
 * removed) and then mapped into the StudentProfile-shaped record that
 * toPublicProfileDTO already sanitizes, so every identity shares one public contract.
 */
import StudentProfile from "../../models/StudentProfile";
import ProfessionalProfile from "../../models/ProfessionalProfile";
import FreelancerProfile from "../../models/FreelancerProfile";
import CreatorProfile from "../../models/CreatorProfile";
import BusinessProfile from "../../models/BusinessProfile";
import { projectPublicDomainProfile } from "./public-projection";
import { deliveryPath } from "../storage/asset-refs";
import { isAssetId } from "../storage/keys";

type Row = Record<string, unknown>;

export type DomainIdentity = "professional" | "freelancer" | "creator" | "business";

interface ProfileLookupModel {
  findOne: (filter: Row) => Promise<unknown>;
}

interface SourceUser {
  _id: unknown;
  name?: string;
  identity?: string | null;
}

export interface WebsiteSource {
  identity: string;
  source: Row;
  updatedAt?: Date | string;
}

export interface CardSeedFields {
  headline?: string;
  institution?: string;
  degree?: string;
  phone?: string;
  github?: string;
  linkedin?: string;
}

const DOMAIN_MODELS: Record<DomainIdentity, unknown> = {
  professional: ProfessionalProfile,
  freelancer: FreelancerProfile,
  creator: CreatorProfile,
  business: BusinessProfile,
};

function asLookup(model: unknown): ProfileLookupModel {
  if (model && typeof model === "object" && "default" in model) {
    const wrapped = model as { default?: ProfileLookupModel };
    if (wrapped.default) return wrapped.default;
  }
  return model as ProfileLookupModel;
}

function toPlain(doc: unknown): Row | null {
  if (!doc || typeof doc !== "object") return null;
  const withToObject = doc as { toObject?: () => Row };
  return typeof withToObject.toObject === "function" ? withToObject.toObject() : (doc as Row);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface Delivery {
  mode: "publish" | "preview";
  ownerId: string;
}

function assetUrl(assetId: unknown, delivery: Delivery): string {
  const id = str(assetId);
  if (!isAssetId(id) || !/^[a-f0-9]{24}$/i.test(delivery.ownerId)) return "";
  return deliveryPath(id, delivery.ownerId, delivery.mode);
}

function addMedia(source: Row, id: string, title: string, url: string, mediaType = "image") {
  if (!url) return;
  const media = rows(source.media);
  media.push({
    id,
    title: title || "Portfolio file",
    mediaUrl: url,
    mediaType,
    category: "project",
    visibility: "public",
  });
  source.media = media;
}

function attachUploadedMedia(projected: Row, source: Row, delivery: Delivery) {
  const media = rows(source.media);
  rows(projected.workSamples).forEach((sample) => {
    const url = assetUrl(sample.assetId, delivery);
    if (!url) return;
    const existing = media.find((item) => str(item.mediaUrl) === str(sample.url) || str(item.title) === str(sample.title));
    if (existing) existing.mediaUrl = url;
    else {
      media.push({
        id: `sample_${str(sample.assetId)}`,
        title: str(sample.title) || "Work sample",
        mediaUrl: url,
        mediaType: "image",
        category: "work-sample",
        visibility: "public",
      });
    }
  });
  if (media.length) source.media = media;
  rows(projected.portfolio).forEach((item, idx) => {
    addMedia(source, `portfolio_${idx}_${str(item.assetId)}`, str(item.title) || "Portfolio image", assetUrl(item.assetId, delivery));
  });
  rows(projected.featuredContent).forEach((item, idx) => {
    addMedia(source, `featured_${idx}_${str(item.assetId)}`, str(item.title) || "Featured image", assetUrl(item.assetId, delivery));
  });
  rows(projected.products).forEach((item, idx) => {
    addMedia(source, `product_${idx}_${str(item.assetId)}`, str(item.name) || "Product image", assetUrl(item.assetId, delivery));
  });
  rows(projected.caseStudies).forEach((item, idx) => {
    addMedia(source, `case_${idx}_${str(item.assetId)}`, str(item.title) || "Case study image", assetUrl(item.assetId, delivery));
  });
  addMedia(source, "media_kit", "Media kit", assetUrl(block(projected.mediaKit).assetId, delivery), "document");
  const logo = assetUrl(block(projected.branding).assetId, delivery);
  if (logo) source.profilePhoto = logo;
}

function presentStudent(plain: Row, delivery: Delivery): Row {
  const copy: Row = { ...plain };
  const projects = rows(copy.projects).map((project) => ({ ...project }));
  const media = rows(copy.media).map((item) => ({ ...item }));
  projects.forEach((project, idx) => {
    const url = assetUrl(project.assetId, delivery);
    if (url) {
      media.push({
        id: `project_asset_${idx}`,
        title: str(project.title) || "Project image",
        mediaUrl: url,
        mediaType: "image",
        category: "project",
        visibility: "public",
      });
    }
    delete project.assetId;
  });
  for (const item of media) {
    const url = assetUrl(item.assetId, delivery);
    if (url && item.visibility !== "private") item.mediaUrl = url;
    delete item.assetId;
  }
  copy.projects = projects;
  copy.media = media;
  if (copy.resume && typeof copy.resume === "object") {
    const resume = { ...(copy.resume as Row) };
    delete resume.assetId;
    delete resume.storageKey;
    copy.resume = resume;
  }
  copy.achievements = rows(copy.achievements).map((item) => {
    const next = { ...item };
    delete next.assetId;
    delete next.evidenceStorageKey;
    return next;
  });
  copy.credentials = rows(copy.credentials).map((item) => {
    const next = { ...item };
    delete next.assetId;
    return next;
  });
  return copy;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === "object") : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

function block(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function rowId(row: Row, prefix: string, idx: number): string {
  return str(row.id) || (row._id ? String(row._id) : `${prefix}_${idx}`);
}

function isDomainIdentity(identity: unknown): identity is DomainIdentity {
  return typeof identity === "string" && identity in DOMAIN_MODELS;
}

function mapSkills(list: unknown, category: string): Row[] {
  return rows(list)
    .filter((s) => str(s.name))
    .map((s, idx) => ({
      id: rowId(s, "skill", idx),
      name: str(s.name),
      category,
      proficiency: str(s.proficiency) || "Intermediate",
      yearsExperience: typeof s.yearsExperience === "number" ? s.yearsExperience : undefined,
    }));
}

function mapEducation(list: unknown): Row[] {
  return rows(list)
    .filter((e) => str(e.institution) && str(e.degree))
    .map((e, idx) => ({
      id: rowId(e, "edu", idx),
      institution: str(e.institution),
      degree: str(e.degree),
      fieldOfStudy: str(e.fieldOfStudy),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
      currentStatus: str(e.currentStatus) || "completed",
    }));
}

function employmentAchievement(job: Row, idx: number): Row | null {
  const title = str(job.jobTitle);
  const company = str(job.company);
  if (!title && !company) return null;
  const range = [str(job.startDate), job.isCurrent ? "Present" : str(job.endDate)].filter(Boolean).join(" – ");
  const details = [...strings(job.responsibilities), ...strings(job.achievements)].join("\n");
  return {
    id: rowId(job, "exp", idx),
    title: title && company ? `${title} at ${company}` : title || company,
    category: "experience",
    organization: company,
    role: title,
    date: range,
    location: str(job.location),
    description: details,
  };
}

function professionalSource(p: Row): Row {
  const contact = block(p.contact);
  const current = block(p.currentEmployment);
  const experience = [current, ...rows(p.employmentHistory)]
    .map((job, idx) => employmentAchievement(job, idx))
    .filter((row): row is Row => row !== null);
  return {
    headline: str(p.headline),
    bio: str(p.bio),
    city: str(contact.city),
    country: str(contact.country),
    currentStatus: str(current.jobTitle),
    skills: mapSkills(p.skills, "Professional Skills"),
    education: mapEducation(p.education),
    credentials: rows(p.certifications)
      .filter((c) => str(c.title))
      .map((c, idx) => ({
        id: rowId(c, "cred", idx),
        title: str(c.title),
        credentialType: "certification",
        issuer: str(c.issuer),
        issueDate: str(c.issueDate),
        expirationDate: str(c.expirationDate),
        credentialUrl: str(c.credentialUrl),
        verificationStatus: str(c.verificationStatus),
      })),
    projects: rows(p.portfolio)
      .filter((item) => str(item.title))
      .map((item, idx) => ({
        id: rowId(item, "proj", idx),
        title: str(item.title),
        shortDescription: str(item.description),
        role: str(item.role),
        liveUrl: str(item.url),
        technologies: [],
      })),
    achievements: [
      ...experience,
      ...rows(p.achievements)
        .filter((item) => str(item.title))
        .map((item, idx) => ({
          id: rowId(item, "achievement", idx),
          title: str(item.title),
          category: "other",
          organization: str(item.organization),
          date: str(item.date),
          description: str(item.description),
          proofUrl: str(item.evidenceUrl),
        })),
    ],
    links: rows(p.socialLinks)
      .filter((item) => str(item.url))
      .map((item, idx) => ({
        id: rowId(item, "social", idx),
        platform: str(item.platform),
        url: str(item.url),
        username: str(item.label),
        category: "social",
        visibility: "public",
      })),
    contacts: {
      email: str(contact.email),
      phone: str(contact.phone),
      linkedin: str(contact.linkedin),
      portfolio: str(contact.website),
      visibility: block(contact.visibility),
    },
  };
}

function freelancerSource(p: Row): Row {
  const contact = block(p.contact);
  const services = rows(p.services)
    .filter((s) => str(s.name))
    .map((s, idx) => {
      const packageLines = rows(s.packages)
        .filter((pkg) => str(pkg.name))
        .map((pkg) => {
          const price = typeof pkg.price === "number" ? `${str(pkg.currency)} ${pkg.price}`.trim() : "";
          return ["Package: " + str(pkg.name), price, str(pkg.description)].filter(Boolean).join(" — ");
        });
      return {
        id: rowId(s, "service", idx),
        title: str(s.name),
        shortDescription: [str(s.description), ...packageLines].filter(Boolean).join("\n"),
        projectType: "service",
        technologies: [],
      };
    });
  const portfolio = rows(p.portfolio)
    .filter((item) => str(item.title))
    .map((item, idx) => ({
      id: rowId(item, "proj", idx),
      title: str(item.title),
      shortDescription: str(item.summary),
      liveUrl: str(item.url),
      impact: str(item.outcome),
      projectType: "case-study",
      technologies: [],
    }));
  const technologies = strings(p.technologies).map((name, idx) => ({
    id: `tech_${idx}`,
    name,
    category: "Technologies",
    proficiency: "Intermediate",
  }));
  return {
    headline: str(p.headline),
    bio: str(p.bio),
    currentStatus: str(p.availability),
    careerInterests: [str(p.specialization), ...strings(p.engagementTypes)].filter(Boolean),
    skills: [...mapSkills(p.skills, "Skills"), ...technologies],
    projects: [
      ...services,
      ...portfolio,
      ...rows(p.workExperience)
        .filter((job) => str(job.company) || str(job.jobTitle))
        .map((job, idx) => ({
          id: rowId(job, "work", idx),
          title: [str(job.jobTitle), str(job.company)].filter(Boolean).join(" at "),
          shortDescription: [str(job.description), ...strings(job.responsibilities)].filter(Boolean).join("\n"),
          role: str(job.jobTitle),
          startDate: str(job.startDate),
          endDate: job.isCurrent ? "" : str(job.endDate),
          projectType: "freelance",
          technologies: [],
        })),
    ],
    achievements: rows(p.testimonials)
      .filter((t) => str(t.quote))
      .map((t, idx) => ({
        id: rowId(t, "testimonial", idx),
        title: `“${str(t.quote)}”`,
        category: "testimonial",
        organization: str(t.authorName),
        role: str(t.relationship),
        description: str(t.attribution) === "verified" ? "Verified testimonial" : "Self-reported testimonial",
      })),
    media: rows(p.workSamples)
      .filter((w) => str(w.url))
      .map((w, idx) => ({
        id: rowId(w, "sample", idx),
        mediaUrl: str(w.url),
        mediaType: str(w.mediaType) || "link",
        title: str(w.title) || "Work sample",
        category: "work-sample",
      })),
    contacts: {
      email: str(contact.email),
      phone: str(contact.phone),
      visibility: block(contact.visibility),
    },
  };
}

function creatorSource(p: Row): Row {
  const contact = block(p.contact);
  const mediaKit = block(p.mediaKit);
  const visibility = block(contact.visibility);
  const partnershipPublic = visibility.partnershipEmail === "public" && str(contact.partnershipEmail);
  const publicEmail = visibility.email === "public" ? str(contact.email) : "";
  return {
    preferredName: str(p.displayName) || undefined,
    headline: str(p.headline) || str(p.niche),
    bio: str(p.bio),
    careerInterests: strings(p.contentCategories),
    areasOfInterest: strings(p.contentFormats),
    projects: rows(p.featuredContent)
      .filter((f) => str(f.title))
      .map((f, idx) => ({
        id: rowId(f, "content", idx),
        title: str(f.title),
        shortDescription: [str(f.summary), str(f.thumbnailUrl) ? "Thumbnail: " + str(f.thumbnailUrl) : ""].filter(Boolean).join("\n"),
        projectType: str(f.format),
        liveUrl: str(f.url),
        startDate: str(f.publishedAt),
        technologies: str(f.category) ? [str(f.category)] : [],
      })),
    achievements: [
      ...rows(p.pastCollaborations)
        .filter((item) => str(item.organization))
        .map((item, idx) => ({
          id: rowId(item, "collab", idx),
          title: str(item.title) || str(item.organization),
          category: "other",
          organization: str(item.organization),
          date: str(item.date),
          description: [str(item.description), str(item.outcome) ? "Self-reported outcome: " + str(item.outcome) : ""]
            .filter(Boolean)
            .join("\n"),
          proofUrl: str(item.url),
        })),
      ...rows(p.audienceStats)
      .filter((s) => str(s.platform) && typeof s.value === "number")
      .map((s, idx) => ({
        id: rowId(s, "audience", idx),
        title: `${Number(s.value).toLocaleString("en-US")} ${str(s.metric).replace(/_/g, " ")} on ${str(s.platform)}`,
        category: "audience",
        date: str(s.measuredAt),
        description: str(s.verificationStatus) === "verified" ? "Verified" : "Self-reported",
      })),
    ],
    links: rows(p.channels)
      .filter((c) => str(c.url))
      .map((c, idx) => ({
        id: rowId(c, "channel", idx),
        platform: str(c.platform),
        url: str(c.url),
        username: str(c.handle),
        category: "social",
        visibility: "public",
      })),
    contacts: {
      email: publicEmail || partnershipPublic || "",
      portfolio: str(mediaKit.kitUrl),
      visibility: { email: publicEmail || partnershipPublic ? "public" : "private" },
    },
  };
}

function businessSource(p: Row): Row {
  const contact = block(p.publicContact);
  const location = block(p.location);
  const branding = block(p.branding);
  const asProject = (projectType: string, prefix: string) => (item: Row, idx: number) => {
    const price = typeof item.price === "number" ? [str(item.currency), String(item.price)].filter(Boolean).join(" ") : "";
    return {
      id: rowId(item, prefix, idx),
      title: str(item.name) || str(item.title),
      shortDescription: [str(item.description) || str(item.summary), price, str(item.imageUrl) ? "Image: " + str(item.imageUrl) : ""].filter(Boolean).join("\n"),
      liveUrl: str(item.url),
      projectType,
      technologies: [],
    };
  };
  const headlineParts = [str(p.industry), str(p.organizationType).replace(/_/g, " ")].filter(Boolean);
  const founded = typeof p.foundedYear === "number" ? "Founded " + String(p.foundedYear) : "";
  const customers = strings(p.targetCustomers);
  return {
    preferredName: str(p.businessName),
    headline: str(p.tagline) || headlineParts.join(" · "),
    bio: [str(p.description), str(p.mission), founded, str(p.businessModel).replace(/_/g, " "), customers.length ? "Customers: " + customers.join(", ") : ""]
      .filter(Boolean)
      .join("\n\n"),
    profilePhoto: str(branding.logoUrl),
    city: str(location.city) || str(contact.city),
    state: str(location.state),
    country: str(location.country) || str(contact.country),
    projects: [
      ...rows(p.products).filter((i) => str(i.name)).map(asProject("product", "product")),
      ...rows(p.services).filter((i) => str(i.name)).map(asProject("service", "service")),
      ...rows(p.caseStudies).filter((i) => str(i.title)).map(asProject("case-study", "case")),
    ],
    credentials: rows(p.credentials)
      .filter((item) => str(item.title))
      .map((item, idx) => ({
        id: rowId(item, "credential", idx),
        title: str(item.title),
        credentialType: str(item.recordType) === "award" ? "other" : "certification",
        issuer: str(item.issuer),
        issueDate: str(item.issueDate),
        expirationDate: str(item.expirationDate),
        credentialUrl: str(item.evidenceUrl),
        description: str(item.description),
        verificationStatus: str(item.verificationStatus) || "self-reported",
      })),
    achievements: rows(p.team)
      .filter((m) => str(m.name))
      .map((m, idx) => ({
        id: rowId(m, "team", idx),
        title: str(m.name),
        category: "team",
        role: str(m.role),
      })),
    links: rows(p.resources)
      .filter((r) => str(r.url))
      .map((r, idx) => ({
        id: rowId(r, "resource", idx),
        platform: str(r.title) || "resource",
        url: str(r.url),
        category: "resource",
        visibility: "public",
      })),
    contacts: {
      email: str(contact.email),
      phone: str(contact.phone),
      portfolio: str(p.website),
      visibility: block(contact.visibility),
    },
  };
}

const MAPPERS: Record<DomainIdentity, (profile: Row) => Row> = {
  professional: professionalSource,
  freelancer: freelancerSource,
  creator: creatorSource,
  business: businessSource,
};

/** Maps a stored domain profile into the StudentProfile-shaped record used by toPublicProfileDTO. */
export function domainProfileToPublicSource(
  identity: DomainIdentity,
  profile: unknown,
  options?: { mode?: "publish" | "preview"; ownerId?: string }
): Row {
  const plain = toPlain(profile) || {};
  const delivery: Delivery = {
    mode: options?.mode === "preview" ? "preview" : "publish",
    ownerId: options?.ownerId || str(plain.userId),
  };
  const projected = projectPublicDomainProfile(plain);
  const source = MAPPERS[identity](projected);
  attachUploadedMedia(projected, source, delivery);
  return source;
}

/** Loads the record a user publishes from, or null when the user has not saved a profile yet. */
export async function loadWebsiteSource(
  user: SourceUser,
  options?: { mode?: "publish" | "preview" }
): Promise<WebsiteSource | null> {
  const identity = user.identity || "student";
  const delivery = { mode: options?.mode === "preview" ? "preview" as const : "publish" as const, ownerId: String(user._id) };
  if (isDomainIdentity(identity)) {
    const doc = toPlain(await asLookup(DOMAIN_MODELS[identity]).findOne({ userId: user._id }));
    if (!doc) return null;
    return {
      identity,
      source: domainProfileToPublicSource(identity, doc, delivery),
      updatedAt: doc.updatedAt as Date | string | undefined,
    };
  }
  const studentDoc = await asLookup(StudentProfile).findOne({ userId: user._id });
  if (!studentDoc) return null;
  const plain = toPlain(studentDoc) || {};
  return {
    identity: "student",
    source: presentStudent(plain, delivery),
    updatedAt: plain.updatedAt as Date | string | undefined,
  };
}

/** True when the source has at least one section a public website can show. */
export function hasPublishableContent(source: Row): boolean {
  return Boolean(
    str(source.headline) ||
      str(source.bio) ||
      rows(source.education).length > 0 ||
      rows(source.projects).length > 0 ||
      rows(source.skills).length > 0 ||
      rows(source.achievements).length > 0 ||
      rows(source.credentials).length > 0
  );
}

/** Fields used to pre-fill a new visiting card for the signed-in user's identity. */
export async function loadCardSeedFields(user: SourceUser): Promise<CardSeedFields> {
  const identity = user.identity || "student";
  if (!isDomainIdentity(identity)) {
    const studentProfile = toPlain(await asLookup(StudentProfile).findOne({ userId: user._id }));
    const primaryEdu = rows(studentProfile?.education)[0];
    const contacts = block(studentProfile?.contacts);
    return {
      headline: str(studentProfile?.headline) || undefined,
      institution: primaryEdu ? str(primaryEdu.institution) || undefined : undefined,
      degree: primaryEdu ? str(primaryEdu.degree) || undefined : undefined,
      phone: str(contacts.phone) || undefined,
      github: str(contacts.github) || undefined,
      linkedin: str(contacts.linkedin) || undefined,
    };
  }

  const p = toPlain(await asLookup(DOMAIN_MODELS[identity]).findOne({ userId: user._id })) || {};
  const pick = (...values: unknown[]) => values.map(str).find(Boolean) || undefined;
  switch (identity) {
    case "professional": {
      const current = block(p.currentEmployment);
      const contact = block(p.contact);
      return {
        headline: pick(p.headline),
        institution: pick(current.company),
        degree: pick(current.jobTitle),
        phone: pick(contact.phone),
        linkedin: pick(contact.linkedin),
      };
    }
    case "freelancer": {
      const contact = block(p.contact);
      return { headline: pick(p.headline), institution: pick(p.specialization), phone: pick(contact.phone) };
    }
    case "creator":
      return { headline: pick(p.headline, p.niche, p.bio), institution: pick(strings(p.contentCategories)[0]) };
    case "business": {
      const contact = block(p.publicContact);
      return {
        headline: pick(p.tagline, p.industry, p.description),
        institution: pick(p.businessName),
        phone: pick(contact.phone),
      };
    }
  }
}
