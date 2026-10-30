export interface ApiUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  identity: "student" | "professional" | "freelancer" | "creator" | "business";
  bio?: string;
  location?: string;
  profilePhotoKey?: string | null;
  profilePhotoUrl?: string | null;
  onboarding?: {
    surveyCompleted: boolean;
    surveyResponses?: Record<string, unknown>;
  };
}

export interface ApiSession {
  token: string;
  user: ApiUser;
}

export interface ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;
}

export interface CardDesignDocument {
  orientation: "horizontal" | "vertical";
  front: {
    background: { type: string; value: string };
    elements: Array<Record<string, unknown>>;
  };
  back: {
    background: { type: string; value: string };
    elements: Array<Record<string, unknown>>;
  };
}

export interface VisitingCardResponse {
  _id: string;
  userId: string;
  username: string;
  isDefault: boolean;
  selectedTemplateId: string;
  designName: string;
  designDocument: CardDesignDocument;
  publicationStatus: "draft" | "published";
  publishedSnapshot?: CardDesignDocument | null;
}

export interface ResumeReviewRow {
  id: string;
  section: string;
  entryIndex: number;
  field: string;
  value: string;
  applicable: boolean;
  confidence?: "high" | "medium" | "low" | null;
  note?: string | null;
}

export interface ResumeReviewResponse {
  reviewId: string;
  rows: ResumeReviewRow[];
  sections: Array<{ id: string; label: string; rows: ResumeReviewRow[] }>;
  warnings: Array<{ path: string; code: string; message: string }>;
  schemaVersion: string;
}

export interface OneVueApiClient {
  getBaseUrl(): string;
  health: {
    check(): Promise<{ status: string; service: string; database: string }>;
  };
  auth: {
    register(payload: { name: string; email: string; password: string; identity?: string }): Promise<ApiSession>;
    login(email: string, password: string): Promise<ApiSession>;
    me(): Promise<{ user: ApiUser }>;
    setIdentity(identity: string): Promise<ApiSession>;
    submitSurvey(surveyData: Record<string, unknown>): Promise<ApiSession>;
  };
  profile: {
    get(): Promise<{ user: ApiUser }>;
    update(patch: Partial<ApiUser>): Promise<{ message: string; user: ApiUser }>;
    changePassword(current: string, newPass: string): Promise<{ message: string }>;
    uploadPhoto(file: File): Promise<{ message: string; profilePhotoKey: string; profilePhotoUrl: string }>;
    checkUsername(username: string): Promise<{ username: string; available: boolean; reason?: string; suggestions: string[] }>;
  };
  roles: {
    getDashboard(role: string): Promise<{ authorized: boolean; role: string; user: ApiUser; baseline: unknown }>;
    getProfile(role: string): Promise<{ profile: unknown }>;
    updateProfile(role: string, data: unknown): Promise<{ message: string; profile: unknown }>;
  };
  cards: {
    get(cardId?: string | null): Promise<{ activeCard: VisitingCardResponse; cards: VisitingCardResponse[]; templates: unknown[] }>;
    create(templateId: string, designName: string): Promise<{ success: boolean; card: VisitingCardResponse }>;
    duplicate(sourceCardId: string): Promise<{ success: boolean; card: VisitingCardResponse }>;
    save(cardId: string, patch: Partial<VisitingCardResponse>): Promise<{ success: boolean; card: VisitingCardResponse }>;
    delete(cardId: string): Promise<{ success: boolean; message: string }>;
    publish(cardId?: string, setAsDefault?: boolean): Promise<{ success: boolean; publishedUrl: string; snapshot: unknown }>;
    unpublish(cardId?: string): Promise<{ success: boolean; message: string }>;
    uploadAsset(file: File): Promise<{ success: boolean; assetUrl: string; assetKey: string }>;
    getQrUrl(username: string, format?: "svg" | "png"): string;
  };
  certificates: {
    submit(payload: { url: string; issuer?: string; credentialId?: string }): Promise<unknown>;
    get(id: string): Promise<unknown>;
    verify(id: string): Promise<unknown>;
  };
  resume: {
    extract(file: File): Promise<ResumeReviewResponse>;
    getReview(reviewId: string): Promise<ResumeReviewResponse>;
    discardReview(reviewId: string): Promise<{ discarded: boolean }>;
    apply(reviewId: string, selections: unknown[]): Promise<{ message: string }>;
  };
  website: {
    getConfig(): Promise<{ success: boolean; config: unknown }>;
    saveConfig(payload: unknown): Promise<{ success: boolean; config: unknown }>;
    getPreview(): Promise<{ success: boolean; previewData: unknown; config: unknown }>;
    publish(): Promise<{ success: boolean; liveUrl: string; revisionNumber: number }>;
    getHistory(): Promise<{ success: boolean; revisions: unknown[] }>;
    rollback(revisionId: string): Promise<{ success: boolean; activeRevisionNumber: number }>;
  };
  analytics: {
    track(type: string, resourceId: string, resourceType?: string, metadata?: Record<string, unknown>): Promise<unknown>;
    getOverview(): Promise<unknown>;
  };
  public: {
    getProfile(username: string, view?: string): Promise<unknown>;
    getCard(username: string): Promise<unknown>;
    checkUsername(username: string): Promise<{ username: string; available: boolean; reason?: string; suggestions: string[] }>;
  };
}

declare global {
  interface Window {
    OV_API: OneVueApiClient;
  }
}
