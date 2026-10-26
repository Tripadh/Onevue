/**
 * Public projection for domain profiles.
 * Owner APIs return the private document. Nothing in this module is mounted
 * on a public route: a stored profile is not a published profile.
 */

const SENSITIVE_KEYS = new Set([
  "documentStorageKey",
  "storageKey",
  "registrationNumber",
  "addressLine",
  "userId",
]);

function stripSensitive(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripSensitive);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of SENSITIVE_KEYS) delete record[key];
  for (const child of Object.values(record)) stripSensitive(child);
}

function stripPrivateAssetIds(copy: Record<string, unknown>) {
  for (const key of ["achievements", "credentials", "certifications"]) {
    if (!Array.isArray(copy[key])) continue;
    for (const row of copy[key]) {
      if (row && typeof row === "object") delete (row as Record<string, unknown>).assetId;
    }
  }
  if (copy.registration && typeof copy.registration === "object") {
    delete (copy.registration as Record<string, unknown>).assetId;
  }
}

function hidePrivateContact(contact: unknown) {
  if (!contact || typeof contact !== "object") return;
  const block = contact as Record<string, unknown>;
  const visibility =
    block.visibility && typeof block.visibility === "object"
      ? (block.visibility as Record<string, unknown>)
      : {};
  if (visibility.email !== "public") delete block.email;
  if (visibility.phone !== "public") delete block.phone;
  if (visibility.partnershipEmail !== "public") delete block.partnershipEmail;
}

export function projectPublicDomainProfile(profile: unknown): Record<string, unknown> {
  if (!profile || typeof profile !== "object") {
    throw new Error("Profile is required.");
  }
  const copy = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
  stripSensitive(copy);
  stripPrivateAssetIds(copy);
  delete copy.userId;
  delete copy.resume;
  hidePrivateContact(copy.contact);
  hidePrivateContact(copy.publicContact);

  if (Array.isArray(copy.team)) {
    copy.team = copy.team.filter(
      (member) => !!member && typeof member === "object" && (member as { isPublic?: boolean }).isPublic === true
    );
  }
  if (Array.isArray(copy.resources)) {
    copy.resources = copy.resources.filter(
      (item) =>
        !!item &&
        typeof item === "object" &&
        (item as { visibility?: string }).visibility === "public"
    );
  }
  if (Array.isArray(copy.audienceStats)) {
    copy.audienceStats = copy.audienceStats.map((stat) => {
      const row = { ...(stat as Record<string, unknown>) };
      row.independentlyVerified = row.verificationStatus === "verified";
      return row;
    });
  }
  if (Array.isArray(copy.testimonials)) {
    copy.testimonials = copy.testimonials.map((item) => {
      const row = { ...(item as Record<string, unknown>) };
      row.independentlyVerified = row.attribution === "verified";
      return row;
    });
  }

  copy.published = false;
  return copy;
}
