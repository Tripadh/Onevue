// Onevue service contracts. Replace service internals with real API calls;
// keep these signatures and nothing in /components needs to change.

export type ApiMode = 'mock' | 'live';
export interface Env { API_MODE: ApiMode; API_URL: string; PUBLIC_BASE: string; STORAGE_PREFIX: string }

export interface User { id: string; name: string; email: string; username: string | null; createdAt: string }
export interface Session { token: string; user: User }

export type ProfileTypeId = 'student' | 'professional' | 'freelancer' | 'creator' | 'business';
export interface ProfileType { id: ProfileTypeId; name: string; line: string; sections: string[]; glyph: string }

export interface Experience { id: string; role: string; org: string; period: string; note: string }
export interface Education { id: string; degree: string; org: string; period: string; note: string }
export interface PortfolioItem { id: string; title: string; kind: string; metric: string }
export interface Service { id: string; name: string; price: string; time: string }
export interface Profile {
  id: string; userId: string; username: string; name: string; headline: string; location?: string;
  type: ProfileTypeId; avatarInitials: string; summary: string;
  experience: Experience[]; education: Education[]; skills: string[]; portfolio: PortfolioItem[];
  services: Service[]; testimonials: { id: string; quote: string; by: string }[];
  activities: { id: string; title: string; note: string }[]; availability?: string;
  links: { email?: string; phone?: string; web?: string };
}

export type OnevueId = 'recruiter' | 'client' | 'college' | 'contact' | 'business';
export interface Onevue { id: OnevueId; label: string; blurb: string; sections: string[] }
export interface RenderedOnevue {
  onevue: Onevue;
  header: { name: string; headline: string; location?: string; initials: string; username: string };
  sections: { key: string; data: unknown }[];
  hidden: string[];
}

export interface Credential { id: string; profileId: string; title: string; issuer: string; kind: 'Degree' | 'Employment' | 'Certification' | 'Identity'; issued: string; status: 'verified' | 'pending' | 'revoked'; method: string }
export interface VerificationResult { credential: Credential; checkedAt: string; trail: { step: string; detail: string }[] }

export interface Share { id: string; username: string; onevueId?: OnevueId; label: string | null; code: string; url: string; expiresAt: string | null; createdAt: string }
export interface UsernameCheck { username: string; available: boolean; reason?: string; suggestions: string[] }

export interface AuthService {
  getSession(): Promise<Session | null>;
  signUp(i: { name: string; email: string; password: string; username?: string }): Promise<Session>;
  signIn(i: { email: string; password: string }): Promise<Session>;
  signOut(): Promise<void>;
  onChange(fn: (s: Session | null) => void): () => void;
}
export interface ProfileService {
  checkUsername(u: string): Promise<UsernameCheck>;
  claimUsername(u: string, userId: string): Promise<{ username: string; url: string }>;
  getProfileByUsername(u: string): Promise<Profile | null>;
  getMyProfile(userId: string): Promise<Profile | null>;
  updateMyProfile(userId: string, patch: Partial<Profile>): Promise<Profile>;
  getDemoProfile(): Promise<Profile>;
  listProfileTypes(): Promise<ProfileType[]>;
}
export interface OnevuesService { listOnevues(): Promise<Onevue[]>; renderOnevue(p: Profile, f: OnevueId): Promise<RenderedOnevue> }
export interface PortfolioService { listItems(pid: string): Promise<PortfolioItem[]>; addItem(pid: string, i: Omit<PortfolioItem, 'id'>): Promise<PortfolioItem>; removeItem(pid: string, id: string): Promise<boolean> }
export interface CredentialsService { listCredentials(pid: string): Promise<Credential[]>; verify(id: string): Promise<VerificationResult> }
export interface SharesService { buildUrl(u: string, f?: OnevueId): string; createShare(i: { username: string; onevueId?: OnevueId; label?: string; expiresInDays?: number }): Promise<Share>; listShares(u: string): Promise<Share[]>; qrMatrix(url: string, size?: number): Promise<boolean[][]> }
export interface AnalyticsService { track(name: string, props?: Record<string, unknown>): void; getViewStats(u: string): Promise<{ total: number; byOnevue: Record<string, number> }> }
export interface NotificationsService { subscribe(email: string): Promise<{ email: string; already: boolean }> }

