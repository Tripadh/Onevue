interface TemplateContract {
  APPROVED_TEMPLATE_IDS: string[];
  CONTENT_SECTIONS: Array<{
    id: string;
    label: string;
    identities: string[];
    storage: "public-dto" | "identity-profile";
    publicKey: string | null;
    repeatable: boolean;
    blocks: string[];
  }>;
  listTemplates: () => Array<Record<string, unknown>>;
  getTemplate: (id: string) => Record<string, unknown> | null;
  contentForIdentity: (identity: string) => Array<Record<string, unknown>>;
  partitionPublication: (templateId: string, dto: object) => { displayed: string[]; retained: string[] };
  retainedProfileKeys: (templateId: string, identity: string, profile: object) => string[];
  sanitizeStoredText: (value: string) => string;
  presentationForTemplate: (templateId: string, customization: object) => {
    accentColor: string;
    themeMode: string;
    visibleSections: string[];
    sectionOrder: string[];
  };
  publishedCustomization: (
    revisionPresentation: object | null,
    configCustomization: object | null,
    templateId?: string
  ) => {
    accentColor: string;
    themeMode: string;
    visibleSections: string[];
    sectionOrder: string[];
  };
  rollbackPresentation: (
    revisionPresentation: object | null,
    templateId?: string
  ) => {
    accentColor: string;
    themeMode: string;
    visibleSections: string[];
    sectionOrder: string[];
  };
  reorderEntries: <T>(list: T[], index: number, direction: number) => T[];
}

declare const contract: TemplateContract;
export default contract;
