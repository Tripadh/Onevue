import { ICardDesignDocument, ICardElement, ICardBackground } from "../../models/VisitingCard";

export type CardCategory =
  | "Professional"
  | "Minimal"
  | "Creative"
  | "Corporate"
  | "Student"
  | "Freelancer"
  | "Developer"
  | "Creator"
  | "Business";

export interface CardTemplateDefinition {
  id: string;
  name: string;
  category: CardCategory;
  orientation: "horizontal" | "vertical";
  description: string;
  tags: string[];
  defaultBackground: {
    type: "solid" | "gradient";
    color: string;
    gradient?: string;
  };
  backBackground: {
    type: "solid" | "gradient";
    color: string;
    gradient?: string;
  };
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
}

export const VISITING_CARD_TEMPLATES: Record<string, CardTemplateDefinition> = {
  "academic-classic": {
    id: "academic-classic",
    name: "Academic Classic",
    category: "Student",
    orientation: "horizontal",
    description: "Prestigious ivory, navy, and gold styling tailored for university symposiums, college job fairs, and research peers.",
    tags: ["student", "academic", "university", "gold", "research", "symposium"],
    defaultBackground: {
      type: "solid",
      color: "#FAF8F5",
    },
    backBackground: {
      type: "solid",
      color: "#0F1E36",
    },
    primaryColor: "#0F1E36",
    accentColor: "#C5A880",
    fontFamily: "Cormorant Garamond, serif",
  },
  "minimal": {
    id: "minimal",
    name: "Minimal Monochrome",
    category: "Minimal",
    orientation: "horizontal",
    description: "Pristine white canvas with stark black editorial typography, balanced whitespace, and high-impact contrast.",
    tags: ["minimal", "monochrome", "modern", "black and white", "clean", "simple"],
    defaultBackground: {
      type: "solid",
      color: "#FFFFFF",
    },
    backBackground: {
      type: "solid",
      color: "#0A0A0A",
    },
    primaryColor: "#0A0A0A",
    accentColor: "#525252",
    fontFamily: "Inter, sans-serif",
  },
  "corporate-vanguard": {
    id: "corporate-vanguard",
    name: "Corporate Vanguard",
    category: "Corporate",
    orientation: "horizontal",
    description: "Deep obsidian backdrop with metallic cyan accents, balanced dual-column credentials, and enterprise authority.",
    tags: ["corporate", "executive", "enterprise", "cyan", "finance", "leadership"],
    defaultBackground: {
      type: "solid",
      color: "#0B0F19",
    },
    backBackground: {
      type: "solid",
      color: "#030712",
    },
    primaryColor: "#F8FAFC",
    accentColor: "#38BDF8",
    fontFamily: "Inter, sans-serif",
  },
  "professional": {
    id: "professional",
    name: "Executive Slate",
    category: "Professional",
    orientation: "horizontal",
    description: "Balanced corporate hierarchy with slate navy accents, clean dual-column contact grid, and verified seals.",
    tags: ["professional", "slate", "consulting", "executive", "corporate", "law"],
    defaultBackground: {
      type: "solid",
      color: "#F8FAFC",
    },
    backBackground: {
      type: "solid",
      color: "#0F172A",
    },
    primaryColor: "#0F172A",
    accentColor: "#2563EB",
    fontFamily: "Inter, sans-serif",
  },
  "developer": {
    id: "developer",
    name: "Terminal Developer",
    category: "Developer",
    orientation: "horizontal",
    description: "Dark carbon monospace aesthetic with emerald prompts, GitHub repositories, and verifiable code credentials.",
    tags: ["developer", "tech", "engineer", "software", "terminal", "github", "code"],
    defaultBackground: {
      type: "solid",
      color: "#0D1117",
    },
    backBackground: {
      type: "solid",
      color: "#010409",
    },
    primaryColor: "#E6EDF3",
    accentColor: "#10B981",
    fontFamily: "monospace",
  },
  "creative": {
    id: "creative",
    name: "Creative Studio",
    category: "Creative",
    orientation: "horizontal",
    description: "Expressive editorial styling with bold warmth, modern curves, sunset gradients, and media showcase links.",
    tags: ["creative", "designer", "studio", "art", "editorial", "warm", "portfolio"],
    defaultBackground: {
      type: "gradient",
      color: "#FFF7ED",
      gradient: "linear-gradient(135deg, #FFF7ED 0%, #FEE2E2 100%)",
    },
    backBackground: {
      type: "solid",
      color: "#EA580C",
    },
    primaryColor: "#1E1B4B",
    accentColor: "#EA580C",
    fontFamily: "Inter, sans-serif",
  },
  "freelancer-modern": {
    id: "freelancer-modern",
    name: "Independent Consultant",
    category: "Freelancer",
    orientation: "horizontal",
    description: "Warm neutral oat canvas with bronze accents, services overview pill, direct client booking, and contact links.",
    tags: ["freelancer", "consultant", "independent", "remote", "services", "bronze"],
    defaultBackground: {
      type: "solid",
      color: "#FDFCF7",
    },
    backBackground: {
      type: "solid",
      color: "#1C1917",
    },
    primaryColor: "#1C1917",
    accentColor: "#B45309",
    fontFamily: "Inter, sans-serif",
  },
  "creator-bold": {
    id: "creator-bold",
    name: "Content & Media Creator",
    category: "Creator",
    orientation: "vertical",
    description: "Vertical portrait format with electric violet accents, prominent creator avatar, channel handles, and rapid QR scan.",
    tags: ["creator", "youtube", "podcast", "media", "vertical", "portrait", "influencer"],
    defaultBackground: {
      type: "solid",
      color: "#180828",
    },
    backBackground: {
      type: "solid",
      color: "#0F041A",
    },
    primaryColor: "#FFFFFF",
    accentColor: "#E879F9",
    fontFamily: "Inter, sans-serif",
  },
  "modern-business": {
    id: "modern-business",
    name: "Modern Commerce",
    category: "Business",
    orientation: "vertical",
    description: "Vertical architecture with deep forest emerald and amber foil accents for startups, founders, and local enterprises.",
    tags: ["business", "commerce", "startup", "founder", "vertical", "emerald", "gold"],
    defaultBackground: {
      type: "solid",
      color: "#F8FAF9",
    },
    backBackground: {
      type: "solid",
      color: "#064E3B",
    },
    primaryColor: "#064E3B",
    accentColor: "#D97706",
    fontFamily: "Inter, sans-serif",
  },
};

export interface StudentCardSeedInfo {
  name?: string;
  headline?: string;
  institution?: string;
  degree?: string;
  email?: string;
  phone?: string;
  location?: string;
  username?: string;
  photoUrl?: string | null;
  github?: string;
  linkedin?: string;
  portfolioUrl?: string;
}

export function generateDefaultCardDesign(
  templateId: string,
  info: StudentCardSeedInfo
): ICardDesignDocument {
  const tmpl = VISITING_CARD_TEMPLATES[templateId] || VISITING_CARD_TEMPLATES["academic-classic"];
  const name = info.name || "Alex Mercer";
  const title = info.headline || info.degree || "Product Specialist & Researcher";
  const institution = info.institution || "OneVue Innovation Labs";
  const email = info.email || "alex.mercer@onevue.id";
  const phone = info.phone || "+1 (555) 234-5678";
  const location = info.location || "San Francisco, CA";
  const username = info.username || "alexmercer";
  const targetUrl = `https://onevue.id/card/${username}`;
  const photoUrl = info.photoUrl || null;

  const isVertical = tmpl.orientation === "vertical";
  const width = isVertical ? 600 : 1050;
  const height = isVertical ? 1050 : 600;

  const frontElements: ICardElement[] = [];
  const backElements: ICardElement[] = [];

  if (isVertical) {
    /* -------------------------------------------------------------
       VERTICAL CARD LAYOUT (600 × 1050 px)
       ------------------------------------------------------------- */
    frontElements.push({
      id: "el_border",
      type: "shape",
      shapeType: "rect",
      x: 24,
      y: 24,
      width: 552,
      height: 1002,
      strokeColor: tmpl.accentColor,
      strokeWidth: 1.5,
      fillColor: "transparent",
      borderRadius: 16,
      zIndex: 1,
      locked: true,
    });

    if (photoUrl) {
      frontElements.push({
        id: "el_photo",
        type: "photo",
        x: 230,
        y: 80,
        width: 140,
        height: 140,
        assetUrl: photoUrl,
        borderRadius: 70,
        borderWidth: 2,
        borderColor: tmpl.accentColor,
        objectFit: "cover",
        zIndex: 2,
      });
    }

    frontElements.push({
      id: "el_name",
      type: "text",
      x: 40,
      y: photoUrl ? 245 : 120,
      width: 520,
      height: 48,
      content: name,
      fontSize: 32,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: tmpl.primaryColor,
      align: "center",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_title",
      type: "text",
      x: 50,
      y: photoUrl ? 300 : 175,
      width: 500,
      height: 36,
      content: title,
      fontSize: 17,
      fontFamily: "Inter, sans-serif",
      fontWeight: "500",
      color: tmpl.category === "Creator" ? "#E2E8F0" : "#4B5563",
      align: "center",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_inst",
      type: "text",
      x: 50,
      y: photoUrl ? 340 : 215,
      width: 500,
      height: 30,
      content: institution,
      fontSize: 14,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      color: tmpl.accentColor,
      align: "center",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_divider",
      type: "divider",
      x: 100,
      y: photoUrl ? 390 : 265,
      width: 400,
      height: 2,
      fillColor: tmpl.accentColor,
      zIndex: 2,
    });

    let curY = photoUrl ? 420 : 295;
    if (email) {
      frontElements.push({
        id: "el_email",
        type: "contact",
        fieldKey: "email",
        label: "Email",
        value: email,
        icon: "mail",
        x: 80,
        y: curY,
        width: 440,
        height: 32,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 45;
    }

    if (phone) {
      frontElements.push({
        id: "el_phone",
        type: "contact",
        fieldKey: "phone",
        label: "Phone",
        value: phone,
        icon: "phone",
        x: 80,
        y: curY,
        width: 440,
        height: 32,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 45;
    }

    if (location) {
      frontElements.push({
        id: "el_loc",
        type: "contact",
        fieldKey: "location",
        label: "Location",
        value: location,
        icon: "map-pin",
        x: 80,
        y: curY,
        width: 440,
        height: 32,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 45;
    }

    frontElements.push({
      id: "el_qr",
      type: "qr",
      x: 210,
      y: 720,
      width: 180,
      height: 180,
      targetUrl,
      fgColor: tmpl.category === "Creator" ? "#000000" : tmpl.primaryColor,
      bgColor: "#FFFFFF",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tmpl.accentColor,
      zIndex: 4,
    });

    frontElements.push({
      id: "el_url",
      type: "text",
      x: 50,
      y: 920,
      width: 500,
      height: 28,
      content: `onevue.id/card/${username}`,
      fontSize: 13.5,
      fontFamily: "monospace",
      color: tmpl.category === "Creator" ? "#94A3B8" : "#6B7280",
      align: "center",
      zIndex: 3,
    });

    // BACK SIDE (Vertical)
    backElements.push({
      id: "el_back_border",
      type: "shape",
      shapeType: "rect",
      x: 24,
      y: 24,
      width: 552,
      height: 1002,
      strokeColor: tmpl.accentColor,
      strokeWidth: 1.5,
      fillColor: "transparent",
      borderRadius: 16,
      zIndex: 1,
      locked: true,
    });

    backElements.push({
      id: "el_back_crest",
      type: "shape",
      shapeType: "circle",
      x: 250,
      y: 180,
      width: 100,
      height: 100,
      fillColor: "rgba(255, 255, 255, 0.08)",
      strokeColor: tmpl.accentColor,
      strokeWidth: 2,
      borderRadius: 50,
      zIndex: 2,
    });

    backElements.push({
      id: "el_back_monogram",
      type: "text",
      x: 200,
      y: 205,
      width: 200,
      height: 50,
      content: name.slice(0, 2).toUpperCase(),
      fontSize: 36,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: tmpl.accentColor,
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_name",
      type: "text",
      x: 50,
      y: 320,
      width: 500,
      height: 44,
      content: name,
      fontSize: 28,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: "#FFFFFF",
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_brand",
      type: "text",
      x: 50,
      y: 375,
      width: 500,
      height: 30,
      content: "ONEVUE VERIFIED PROFILE",
      fontSize: 12.5,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      color: tmpl.accentColor,
      letterSpacing: 2,
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_qr",
      type: "qr",
      x: 185,
      y: 480,
      width: 230,
      height: 230,
      targetUrl,
      fgColor: "#000000",
      bgColor: "#FFFFFF",
      borderRadius: 16,
      zIndex: 4,
    });

    backElements.push({
      id: "el_back_scan_hint",
      type: "text",
      x: 50,
      y: 740,
      width: 500,
      height: 28,
      content: "Scan with camera to connect instantly",
      fontSize: 14,
      fontFamily: "Inter, sans-serif",
      color: "#94A3B8",
      align: "center",
      zIndex: 3,
    });

  } else {
    /* -------------------------------------------------------------
       HORIZONTAL CARD LAYOUT (1050 × 600 px)
       ------------------------------------------------------------- */
    frontElements.push({
      id: "el_border",
      type: "shape",
      shapeType: "rect",
      x: 30,
      y: 30,
      width: 990,
      height: 540,
      strokeColor: tmpl.accentColor,
      strokeWidth: 1.5,
      fillColor: "transparent",
      borderRadius: 12,
      zIndex: 1,
      locked: true,
    });

    if (photoUrl) {
      frontElements.push({
        id: "el_photo",
        type: "photo",
        x: 70,
        y: 80,
        width: 140,
        height: 140,
        assetUrl: photoUrl,
        borderRadius: 70,
        borderWidth: 2,
        borderColor: tmpl.accentColor,
        objectFit: "cover",
        zIndex: 2,
      });
    }

    const textLeft = photoUrl ? 240 : 70;

    frontElements.push({
      id: "el_name",
      type: "text",
      x: textLeft,
      y: 85,
      width: 520,
      height: 50,
      content: name,
      fontSize: 34,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: tmpl.primaryColor,
      align: "left",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_title",
      type: "text",
      x: textLeft,
      y: 140,
      width: 520,
      height: 35,
      content: title,
      fontSize: 18,
      fontFamily: "Inter, sans-serif",
      fontWeight: "500",
      color: tmpl.defaultBackground.color === "#0B0F19" || tmpl.defaultBackground.color === "#0D1117" ? "#94A3B8" : "#4B5563",
      align: "left",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_inst",
      type: "text",
      x: textLeft,
      y: 180,
      width: 520,
      height: 30,
      content: institution,
      fontSize: 15,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      color: tmpl.accentColor,
      align: "left",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_divider",
      type: "divider",
      x: 70,
      y: 250,
      width: 660,
      height: 2,
      fillColor: tmpl.accentColor,
      zIndex: 2,
    });

    let curY = 280;
    if (email) {
      frontElements.push({
        id: "el_email",
        type: "contact",
        fieldKey: "email",
        label: "Email",
        value: email,
        icon: "mail",
        x: 70,
        y: curY,
        width: 380,
        height: 30,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 38;
    }

    if (phone) {
      frontElements.push({
        id: "el_phone",
        type: "contact",
        fieldKey: "phone",
        label: "Phone",
        value: phone,
        icon: "phone",
        x: 70,
        y: curY,
        width: 380,
        height: 30,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 38;
    }

    if (location) {
      frontElements.push({
        id: "el_loc",
        type: "contact",
        fieldKey: "location",
        label: "Location",
        value: location,
        icon: "map-pin",
        x: 70,
        y: curY,
        width: 380,
        height: 30,
        fontSize: 15,
        color: tmpl.primaryColor,
        fontFamily: "Inter, sans-serif",
        zIndex: 3,
      });
      curY += 38;
    }

    frontElements.push({
      id: "el_url",
      type: "text",
      x: 70,
      y: 505,
      width: 500,
      height: 30,
      content: `onevue.id/card/${username}`,
      fontSize: 14,
      fontFamily: "monospace",
      color: tmpl.defaultBackground.color === "#0B0F19" || tmpl.defaultBackground.color === "#0D1117" ? "#94A3B8" : "#6B7280",
      zIndex: 3,
    });

    frontElements.push({
      id: "el_qr",
      type: "qr",
      x: 790,
      y: 190,
      width: 175,
      height: 175,
      targetUrl,
      fgColor: tmpl.defaultBackground.color === "#0B0F19" || tmpl.defaultBackground.color === "#0D1117" ? "#000000" : tmpl.primaryColor,
      bgColor: "#FFFFFF",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tmpl.accentColor,
      zIndex: 4,
    });

    // BACK SIDE (Horizontal)
    backElements.push({
      id: "el_back_border",
      type: "shape",
      shapeType: "rect",
      x: 30,
      y: 30,
      width: 990,
      height: 540,
      strokeColor: tmpl.accentColor,
      strokeWidth: 1.5,
      fillColor: "transparent",
      borderRadius: 12,
      zIndex: 1,
      locked: true,
    });

    backElements.push({
      id: "el_back_crest",
      type: "shape",
      shapeType: "circle",
      x: 485,
      y: 130,
      width: 80,
      height: 80,
      fillColor: "rgba(255, 255, 255, 0.08)",
      strokeColor: tmpl.accentColor,
      strokeWidth: 2,
      borderRadius: 40,
      zIndex: 2,
    });

    backElements.push({
      id: "el_back_monogram",
      type: "text",
      x: 425,
      y: 152,
      width: 200,
      height: 40,
      content: name.slice(0, 2).toUpperCase(),
      fontSize: 28,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: tmpl.accentColor,
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_name",
      type: "text",
      x: 275,
      y: 240,
      width: 500,
      height: 48,
      content: name,
      fontSize: 34,
      fontFamily: tmpl.fontFamily,
      fontWeight: "700",
      color: "#FFFFFF",
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_inst",
      type: "text",
      x: 275,
      y: 300,
      width: 500,
      height: 32,
      content: institution,
      fontSize: 16,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      color: tmpl.accentColor,
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_tagline",
      type: "text",
      x: 275,
      y: 350,
      width: 500,
      height: 28,
      content: "ONEVUE VERIFIED DIGITAL IDENTITY",
      fontSize: 12,
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      color: "rgba(255, 255, 255, 0.6)",
      letterSpacing: 2,
      align: "center",
      zIndex: 3,
    });

    backElements.push({
      id: "el_back_url",
      type: "text",
      x: 275,
      y: 480,
      width: 500,
      height: 28,
      content: `https://onevue.id/card/${username}`,
      fontSize: 13,
      fontFamily: "monospace",
      color: tmpl.accentColor,
      align: "center",
      zIndex: 3,
    });
  }

  const frontBg: ICardBackground = {
    type: tmpl.defaultBackground.type,
    color: tmpl.defaultBackground.color,
    gradient: tmpl.defaultBackground.gradient,
    opacity: 1,
  };

  const backBg: ICardBackground = {
    type: tmpl.backBackground.type,
    color: tmpl.backBackground.color,
    gradient: tmpl.backBackground.gradient,
    opacity: 1,
  };

  return {
    dimensions: {
      width,
      height,
      orientation: tmpl.orientation,
      unit: "px",
    },
    // Top-level legacy fallbacks
    background: frontBg,
    elements: frontElements,
    // Standard double-sided
    front: {
      background: frontBg,
      elements: frontElements,
    },
    back: {
      background: backBg,
      elements: backElements,
    },
  };
}
