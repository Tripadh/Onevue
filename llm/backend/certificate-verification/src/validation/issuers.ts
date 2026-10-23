export const credlyIssuer = {
  id: "credly",
  hostname: "www.credly.com",
  badgeSegment: "badges",
} as const;

export type IssuerId = typeof credlyIssuer.id;
