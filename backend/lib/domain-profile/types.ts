export type DomainIdentity = "professional" | "freelancer" | "creator" | "business";

export type RuleName = "dateOrder" | "rateOrder" | "engagementRate" | "touchUploadedAt";

export interface ManagedField {
  key: string;
  allowed: readonly string[];
  defaultValue: string;
}

export type ScalarField =
  | { kind: "string"; max: number; required?: boolean }
  | {
      kind: "enum";
      values: readonly string[];
      required?: boolean;
      allowEmpty?: boolean;
      defaultValue?: string;
    }
  | { kind: "url"; max?: number; required?: boolean }
  | { kind: "email"; max?: number; required?: boolean }
  | { kind: "phone"; max?: number }
  | { kind: "date"; required?: boolean }
  | { kind: "hex" }
  | { kind: "storageKey" }
  | { kind: "currency" }
  | {
      kind: "number";
      min: number;
      max: number;
      integer?: boolean;
      required?: boolean;
      defaultValue?: number;
    }
  | { kind: "boolean"; defaultValue?: boolean }
  | { kind: "stringList"; maxItems: number; itemMax: number; enumValues?: readonly string[] };

export interface ObjectField {
  kind: "object";
  fields: Record<string, ScalarField | ObjectField>;
  managed?: ManagedField[];
  rules?: RuleName[];
}

export interface CollectionField {
  kind: "collection";
  maxItems: number;
  fields: Record<string, ScalarField>;
  managed?: ManagedField[];
  rules?: RuleName[];
}

export type FieldSpec = ScalarField | ObjectField | CollectionField;

export interface DomainContract {
  identity: DomainIdentity;
  fields: Record<string, FieldSpec>;
}
