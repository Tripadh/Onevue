import mongoose, { Schema, model, models } from "mongoose";

/* =========================================================================
   OneVue Visiting Card Studio — Data Model
   Supports multi-card persistence, double-sided (Front & Back) designs,
   orientations (horizontal / vertical), and immutable publication snapshots.
   ========================================================================= */

export type CardPublicationStatus = "draft" | "published" | "unpublished";
export type CardElementType =
  | "text"
  | "photo"
  | "logo"
  | "qr"
  | "social"
  | "contact"
  | "shape"
  | "divider";

export interface ICardElement {
  id: string;
  type: CardElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;

  // Typography & content (text, contact)
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  color?: string;
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;

  // Media & Assets (photo, logo)
  assetUrl?: string;
  assetKey?: string;
  borderRadius?: number;
  objectFit?: "cover" | "contain";
  borderWidth?: number;
  borderColor?: string;

  // QR element
  targetUrl?: string;
  fgColor?: string;
  bgColor?: string;

  // Contact / Social fields
  fieldKey?: string;
  label?: string;
  value?: string;
  icon?: string;
  url?: string;

  // Shape & Divider
  shapeType?: "rect" | "circle" | "pill" | "divider";
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface ICardBackground {
  type: "solid" | "gradient" | "pattern" | "image";
  color?: string;
  gradient?: string;
  imageUrl?: string;
  opacity?: number;
}

export interface ICardSide {
  background: ICardBackground;
  elements: ICardElement[];
}

export interface ICardDimensions {
  width: number;
  height: number;
  orientation: "horizontal" | "vertical";
  unit: string;
}

export interface ICardDesignDocument {
  dimensions: ICardDimensions;
  // Legacy single-side fallbacks (kept for backward compatibility)
  background?: ICardBackground;
  elements?: ICardElement[];
  // Double-sided specification
  front: ICardSide;
  back: ICardSide;
}

export interface ICardAssetReference {
  key: string;
  publicUrl: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
}

export interface ICardVisibilitySettings {
  showEmail: boolean;
  showPhone: boolean;
  showSocials: boolean;
  showPortfolioLink: boolean;
}

export interface IVisitingCard {
  _id?: Schema.Types.ObjectId | string;
  userId: Schema.Types.ObjectId;
  username: string;
  isDefault: boolean;
  schemaVersion: number;
  selectedTemplateId: string;
  designName?: string;
  designDocument: ICardDesignDocument;
  assetReferences: ICardAssetReference[];
  visibilitySettings: ICardVisibilitySettings;
  publicationStatus: CardPublicationStatus;
  publishedSnapshot?: ICardDesignDocument | null;
  publishedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Normalizes any card design document (legacy single-side or double-sided)
 * into a complete, safe double-sided document.
 */
export function normalizeDesignDocument(raw: any): ICardDesignDocument {
  if (!raw || typeof raw !== "object") {
    return {
      dimensions: { width: 1050, height: 600, orientation: "horizontal", unit: "px" },
      front: { background: { type: "solid", color: "#FAF8F5" }, elements: [] },
      back: { background: { type: "solid", color: "#0F1E36" }, elements: [] },
      background: { type: "solid", color: "#FAF8F5" },
      elements: [],
    };
  }

  const orientation: "horizontal" | "vertical" =
    raw.dimensions?.orientation === "vertical" ? "vertical" : "horizontal";

  const defaultWidth = orientation === "vertical" ? 600 : 1050;
  const defaultHeight = orientation === "vertical" ? 1050 : 600;

  const dimensions: ICardDimensions = {
    width: typeof raw.dimensions?.width === "number" ? raw.dimensions.width : defaultWidth,
    height: typeof raw.dimensions?.height === "number" ? raw.dimensions.height : defaultHeight,
    orientation,
    unit: raw.dimensions?.unit || "px",
  };

  const frontBackground: ICardBackground =
    raw.front?.background || raw.background || { type: "solid", color: "#FAF8F5" };

  const frontElements: ICardElement[] = Array.isArray(raw.front?.elements)
    ? raw.front.elements
    : Array.isArray(raw.elements)
    ? raw.elements
    : [];

  const backBackground: ICardBackground = raw.back?.background || {
    type: "solid",
    color: frontBackground.type === "solid" && frontBackground.color === "#FFFFFF" ? "#0A0A0A" : "#0F1E36",
  };

  const backElements: ICardElement[] = Array.isArray(raw.back?.elements)
    ? raw.back.elements
    : [];

  return {
    dimensions,
    background: frontBackground,
    elements: frontElements,
    front: {
      background: frontBackground,
      elements: frontElements,
    },
    back: {
      background: backBackground,
      elements: backElements,
    },
  };
}

const CardElementSchema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "photo", "logo", "qr", "social", "contact", "shape", "divider"],
      required: true,
    },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    rotation: { type: Number, default: 0 },
    zIndex: { type: Number, default: 1 },
    locked: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },

    content: { type: String, maxlength: 500 },
    fontSize: { type: Number, min: 6, max: 120 },
    fontFamily: { type: String, maxlength: 80 },
    fontWeight: { type: Schema.Types.Mixed },
    color: { type: String, maxlength: 40 },
    align: { type: String, enum: ["left", "center", "right"], default: "left" },
    letterSpacing: { type: Number },
    lineHeight: { type: Number },

    assetUrl: { type: String, maxlength: 1000 },
    assetKey: { type: String, maxlength: 250 },
    borderRadius: { type: Number, min: 0, max: 200 },
    objectFit: { type: String, enum: ["cover", "contain"], default: "cover" },
    borderWidth: { type: Number, min: 0, max: 20 },
    borderColor: { type: String, maxlength: 40 },

    targetUrl: { type: String, maxlength: 1000 },
    fgColor: { type: String, maxlength: 40 },
    bgColor: { type: String, maxlength: 40 },

    fieldKey: { type: String, maxlength: 50 },
    label: { type: String, maxlength: 100 },
    value: { type: String, maxlength: 500 },
    icon: { type: String, maxlength: 50 },
    url: { type: String, maxlength: 1000 },

    shapeType: { type: String, enum: ["rect", "circle", "pill", "divider"] },
    fillColor: { type: String, maxlength: 40 },
    strokeColor: { type: String, maxlength: 40 },
    strokeWidth: { type: Number, min: 0, max: 20 },
  },
  { _id: false }
);

const CardBackgroundSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["solid", "gradient", "pattern", "image"],
      default: "solid",
    },
    color: { type: String, default: "#FAF8F5" },
    gradient: { type: String },
    imageUrl: { type: String },
    opacity: { type: Number, min: 0, max: 1, default: 1 },
  },
  { _id: false }
);

const CardSideSchema = new Schema(
  {
    background: {
      type: CardBackgroundSchema,
      default: () => ({ type: "solid", color: "#FAF8F5" }),
    },
    elements: { type: [CardElementSchema], default: [] },
  },
  { _id: false }
);

const CardDimensionsSchema = new Schema(
  {
    width: { type: Number, default: 1050 },
    height: { type: Number, default: 600 },
    orientation: { type: String, enum: ["horizontal", "vertical"], default: "horizontal" },
    unit: { type: String, default: "px" },
  },
  { _id: false }
);

const CardDesignDocumentSchema = new Schema(
  {
    dimensions: { type: CardDimensionsSchema, default: () => ({ width: 1050, height: 600, orientation: "horizontal", unit: "px" }) },
    // Legacy single-side fields
    background: { type: CardBackgroundSchema, default: () => ({ type: "solid", color: "#FAF8F5" }) },
    elements: { type: [CardElementSchema], default: [] },
    // Double-sided specification
    front: { type: CardSideSchema, default: () => ({ background: { type: "solid", color: "#FAF8F5" }, elements: [] }) },
    back: { type: CardSideSchema, default: () => ({ background: { type: "solid", color: "#0F1E36" }, elements: [] }) },
  },
  { _id: false }
);

const CardAssetReferenceSchema = new Schema(
  {
    key: { type: String, required: true },
    publicUrl: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const VisitingCardSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },
    username: {
      type: String,
      required: [true, "username is required"],
      trim: true,
      lowercase: true,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    schemaVersion: {
      type: Number,
      default: 2,
    },
    selectedTemplateId: {
      type: String,
      default: "academic-classic",
      required: true,
    },
    designName: {
      type: String,
      default: "My Visiting Card",
      maxlength: 100,
    },
    designDocument: {
      type: CardDesignDocumentSchema,
      required: true,
    },
    assetReferences: {
      type: [CardAssetReferenceSchema],
      default: [],
    },
    visibilitySettings: {
      showEmail: { type: Boolean, default: true },
      showPhone: { type: Boolean, default: false },
      showSocials: { type: Boolean, default: true },
      showPortfolioLink: { type: Boolean, default: true },
    },
    publicationStatus: {
      type: String,
      enum: ["draft", "published", "unpublished"],
      default: "draft",
      index: true,
    },
    publishedSnapshot: {
      type: CardDesignDocumentSchema,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for user cards query
VisitingCardSchema.index({ userId: 1, updatedAt: -1 });

// Hot-reload safe registration
if (models.VisitingCard) {
  delete (models as Record<string, unknown>).VisitingCard;
}

const VisitingCard = models.VisitingCard || model("VisitingCard", VisitingCardSchema);

// Drop legacy unique index on userId asynchronously if present in existing MongoDB instance.
// With `bufferCommands = false`, collection calls throw synchronously before the
// connection is open, so we defer until the connection is ready (once per process).
const dropLegacyUserIdIndex = async () => {
  try {
    const indexes = await VisitingCard.collection.indexes();
    const legacyUniqueIdx = indexes.find(
      (idx: any) => idx.name === "userId_1" && idx.unique
    );
    if (legacyUniqueIdx) {
      await VisitingCard.collection.dropIndex("userId_1");
    }
  } catch {
    // ignore — best-effort cleanup
  }
};

const globalForCard = globalThis as typeof globalThis & {
  __visitingCardLegacyIdxScheduled?: boolean;
};

if (typeof window === "undefined" && !globalForCard.__visitingCardLegacyIdxScheduled) {
  globalForCard.__visitingCardLegacyIdxScheduled = true;
  if (mongoose.connection.readyState === 1) {
    void dropLegacyUserIdIndex();
  } else {
    mongoose.connection.once("open", () => {
      void dropLegacyUserIdIndex();
    });
  }
}

export default VisitingCard;
