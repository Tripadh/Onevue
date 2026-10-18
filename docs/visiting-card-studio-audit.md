# OneVue Visiting Card Studio — Post-Implementation Audit & Gap Analysis

**Document Status:** Complete  
**Date:** October 2026  
**Auditor:** Senior Full-Stack Engineer, Product Architect & QA Lead  
**Branch:** `tripadh` (Local Verification)  

---

## 1. Executive Summary

A comprehensive post-implementation audit of the **OneVue Visiting Card Studio** was conducted across the backend Next.js App Router services, MongoDB data models, test suites, and frontend React SPA components.

The initial implementation established foundational capabilities: draft saving, element sanitization, template selection, PNG/PDF/vCard exports, and public endpoint isolation with immutable published snapshots. However, several critical architectural and UX gaps were identified when evaluated against the target **Canva / Design.com-inspired** product requirements.

### Gap Analysis Summary Matrix

| ID | Capability Area | Status | Key Findings & Required Upgrades |
|---|---|---|---|
| **REQ-1** | **Multi-Card Management ("My Cards")** | **PARTIAL** | Database schema had `unique: true` on `userId`, strictly limiting each user to a single card. No dedicated multi-card management view existed for creating multiple cards, duplicating cards, or deleting cards. |
| **REQ-2** | **Double-Sided Design (Front & Back)** | **PARTIAL** | Canvas engine and database model supported only a single side (1050x600 px). Double-sided cards (front & back sides with distinct backgrounds and elements) are required for realistic business cards. |
| **REQ-3** | **Template Discovery Experience** | **PARTIAL** | Only 6 templates existed under 5 categories. Search, category filter pills (Professional, Minimal, Creative, Corporate, Student, Freelancer, Developer, Creator, Business), orientation filters (Horizontal vs Vertical), and favorite persistence were missing. |
| **REQ-4** | **Canva-Style Canvas Editor Engine** | **PARTIAL** | Canvas supported basic drag, 4-corner resize, and single-point rotation, but lacked alignment snapping guides, a dedicated **Layers Management Panel** (reorder, lock, hide), side switching (Front/Back), and pill/custom shapes. |
| **REQ-5** | **Public Card Experience (`#/card/:username`)** | **PARTIAL** | Public page rendered a static single side. Missing interactive 3D flip card experience to seamlessly view both front and back sides. |
| **REQ-6** | **Print-Ready Double-Sided Exports** | **PARTIAL** | PDF generator produced only single-page PDFs; PNG export only exported the front side. Double-sided 2-page PDF (Page 1 Front, Page 2 Back) and Front/Back PNG options needed. |
| **REQ-7** | **Draft vs Publish Separation & Security** | **PASS** | Draft persistence is completely separated from the public snapshot. Editing draft does not mutate the published card. Unauthorized reads/writes are blocked. Verified by automated test suite. |
| **REQ-8** | **Asset Uploads & Storage Security** | **PASS** | Server-side multipart upload enforces 2 MB limit, validates file magic bytes (JPEG, PNG, WebP), prevents path traversal, and attaches references to the card record. |
| **REQ-9** | **QR Code & vCard Integration** | **PASS** | QR code endpoint generates valid SVG/DataURL pointing to `onevue.id/card/${username}`. RFC-compliant `.vcf` vCard download is generated client-side with public contact fields. |
| **REQ-10** | **Test Suites & TypeScript Health** | **PASS** | 98 passing tests across 8 suites. Clean TypeScript check (`tsc --noEmit`) with 0 errors. |

---

## 2. Detailed Findings by Area

### 2.1 Data Model & Persistence (`backend/models/VisitingCard.ts`)
- **Status:** **PARTIAL**
- **Existing State:** `userId` had `unique: true` which blocked users from having multiple visiting cards (e.g., student card, freelance card, developer card). `designDocument` stored a flat `elements` array and single `background`.
- **Required Action:**
  1. Remove `unique: true` on `userId`, maintaining an index `{ userId: 1, updatedAt: -1 }`.
  2. Add `isDefault: { type: Boolean, default: false }` to designate the canonical card shown at `#/card/:username`.
  3. Upgrade `ICardDesignDocument` to include `front: { background, elements }` and `back: { background, elements }`, while maintaining a backward-compatible adapter for legacy single-side documents.
  4. Add orientation support (`horizontal` vs `vertical`).

### 2.2 Template Catalog (`backend/lib/templates/visiting-card-templates.ts`)
- **Status:** **PARTIAL**
- **Existing State:** 6 templates with basic metadata, all single-sided horizontal layouts.
- **Required Action:**
  1. Expand template definitions to include both `front` and `back` element hierarchies.
  2. Add all 9 product categories: `Professional`, `Minimal`, `Creative`, `Corporate`, `Student`, `Freelancer`, `Developer`, `Creator`, and `Business`.
  3. Support both `horizontal` (1050x600 px) and `vertical` (600x1050 px) orientations.
  4. Include searchable tags and brand metadata.

### 2.3 API Route Handlers (`backend/app/api/student/card/`)
- **Status:** **PARTIAL**
- **Existing State:** Handled single card per user. `GET` returned single card; `PUT` updated single card; `POST /publish` published single card.
- **Required Action:**
  1. `GET /api/student/card`: Support `?cardId=...` while returning `cards` array and `activeCard`.
  2. `POST /api/student/card`: Support card creation (`action: 'create'`) and duplication (`action: 'duplicate'`).
  3. `PUT /api/student/card`: Support updating specific card by `cardId`.
  4. `DELETE /api/student/card`: Support card deletion with user ownership verification.
  5. `POST /api/student/card/publish`: Support publishing specific `cardId` and updating canonical `isDefault` pointer.
  6. `GET /api/public/card/[username]`: Return normalized double-sided published snapshot.

### 2.4 Frontend Service (`frontend/services/visiting-card.js`)
- **Status:** **PARTIAL**
- **Existing State:** Basic methods for single card, single-sided canvas rendering, single-page PDF.
- **Required Action:**
  1. Add `listCards()`, `createCard()`, `duplicateCard()`, `deleteCard()`.
  2. Upgrade `renderCardToCanvas(designDoc, side = 'front')` to render front or back.
  3. Upgrade `exportPdf` to generate 2-page PDF (Page 1 = Front, Page 2 = Back) conforming to PDF-1.4 standards.
  4. Upgrade `exportPng` to support downloading Front, Back, or Both.

### 2.5 Editor Canvas & Studio UI (`StudentVisitingCardPage.jsx`)
- **Status:** **PARTIAL**
- **Existing State:** Basic editor without side toggle or layers panel.
- **Required Action:**
  1. Add Front / Back side toggle buttons with visual indicators and keyboard shortcut.
  2. Add dedicated **Layers Panel** in sidebar: lists all elements on active side, supports bring forward / send backward, visibility toggle, lock toggle, and deletion.
  3. Add alignment snapping guides during element dragging.
  4. Add Pill shape and enhanced shape properties.
  5. Add **My Cards** multi-card management view with card previews, badges, duplicate, delete, and publish actions.
  6. Add **Template Discovery** search bar, category filter pills, orientation filter, and favorites toggle.

### 2.6 Public Viewing Experience (`PublicVisitingCard.jsx`)
- **Status:** **PARTIAL**
- **Existing State:** Single static preview canvas.
- **Required Action:**
  1. Implement realistic 3D card flip interaction (click or toggle button to flip between front and back).
  2. Display clear front/back indicators.
  3. Provide full sharing suite: vCard download, public link copy, and PNG download.

---

## 3. Prioritized Implementation Plan

- **P0: Core Data Model & API Safety (Completed in Step 2 & 3)**
  - Support multi-card schema and double-sided document structure.
  - Implement backward-compatibility adapter for legacy data.
  - Implement multi-card CRUD routes with strict ownership enforcement.
- **P1: Template Catalog & Discovery Engine (Step 4)**
  - Expand templates across 9 categories with double-sided layouts.
  - Implement real-time search, category filtering, and favorite persistence.
- **P2: Studio Editor Upgrades (Step 5)**
  - Implement Front/Back side switcher.
  - Implement Layers Management sidebar panel.
  - Implement alignment snapping guides and shape expansions.
- **P3: Multi-Card Management View & Exports (Step 6)**
  - Build "My Cards" management grid with duplication and deletion.
  - Implement 2-page double-sided PDF and Front/Back PNG exports.
- **P4: 3D Flip Public Card & Verification (Step 7)**
  - Upgrade public page with 3D flip interaction.
  - Run regression test suite and verify in browser.
