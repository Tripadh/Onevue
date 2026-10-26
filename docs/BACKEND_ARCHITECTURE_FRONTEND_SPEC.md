# OneVue — End-to-End Backend Architecture & Frontend Integration Specification

> **Target Audience:** Frontend Engineering Team & UI/UX Architects  
> **Status:** Production Reference Specification  
> **Backend Framework:** Next.js 16 (App Router) + TypeScript + Node.js  
> **Database:** MongoDB (Mongoose ODM)  
> **Microservices:** Certificate Verification Service (`:3001`), LLM Extraction Service (`:8000`)  
> **Public Base URL:** `onevue.id`  
> **Local Dev API Base:** `http://localhost:3000/api`

---

## Table of Contents

1. [Executive Summary & System Architecture Topology](#1-executive-summary--system-architecture-topology)
2. [Global Communication & Networking Standards](#2-global-communication--networking-standards)
3. [Authentication, Onboarding & User Profile Pipeline](#3-authentication-onboarding--user-profile-pipeline)
4. [Multi-Role Domain Identity & Workspace Pipelines](#4-multi-role-domain-identity--workspace-pipelines)
5. [Visiting Card Studio End-to-End Pipeline](#5-visiting-card-studio-end-to-end-pipeline)
6. [Website & Portfolio Publishing Pipeline](#6-website--portfolio-publishing-pipeline)
7. [Certificate Verification Service Pipeline](#7-certificate-verification-service-pipeline)
8. [Resume AI Extraction Pipeline (LLM Microservice)](#8-resume-ai-extraction-pipeline-llm-microservice)
9. [Analytics Ingestion & Reporting Pipeline](#9-analytics-ingestion--reporting-pipeline)
10. [Frontend Integration Architecture & Developer Guide](#10-frontend-integration-architecture--developer-guide)
11. [Master Endpoint Quick-Reference Sheet](#11-master-endpoint-quick-reference-sheet)

---

## 1. Executive Summary & System Architecture Topology

OneVue is an identity, portfolio, and networking platform designed for multiple professional domains: **Students**, **Working Professionals**, **Freelancers**, **Content Creators**, and **Businesses**.

The backend architecture is structured around five core pillars:
1. **Separation of Concerns:** Live, editable drafts are strictly segregated from public, immutable published snapshots (e.g., Visiting Cards and Portfolio Websites).
2. **Multi-Domain Tenancy:** Distinct profile schemas and validation engines for each domain identity, while sharing a unified authentication and user account core.
3. **Microservice Delegation:** CPU-intensive resume parsing is delegated to a dedicated Python/FastAPI LLM service (`:8000`), and cryptographic verification of credentials is handled by a specialized Certificate service (`:3001`).
4. **Zero-Trust Security:** Client-supplied fields like `userId`, `_id`, or `verificationStatus` are stripped on update; ownership and role authorization are strictly checked on every request.
5. **High-Performance Public Fast Paths:** Public profiles and cards serve frozen DTOs with aggressive CDN caching headers (`public, max-age=60, s-maxage=300`) without querying internal draft collections.

### High-Level System Topology Diagram

```
+----------------------------------------------------------------------------------------------------+
|                                           FRONTEND CLIENT                                          |
|  (React SPA / HashRouter / Live-Mock Service Layer / Studio Canvas Engine / Analytics SDK Client)  |
+----------------------------------------------------------------------------------------------------+
                                      |                            ^
            Bearer Token JWT (Auth)   |                            | Public Frozen DTOs
            JSON / Multipart Payloads |                            | (Cards / Portfolios)
                                      v                            |
+----------------------------------------------------------------------------------------------------+
|                                    NEXT.JS 16 APP ROUTER BACKEND                                   |
|                                        (http://localhost:3000/api)                                 |
|                                                                                                    |
|  +--------------------+  +--------------------+  +---------------------+  +---------------------+  |
|  |    /api/auth/*     |  |    /api/profile    |  |  /api/student/card  |  | /api/student/website|  |
|  | Login, Reg, Survey |  | Core Info & Photos |  | Double-Sided Studio |  | Snapshots & Rollback|  |
|  +--------------------+  +--------------------+  +---------------------+  +---------------------+  |
|  +--------------------+  +--------------------+  +---------------------+  +---------------------+  |
|  | /api/student/resume|  | /api/student/certs |  |   /api/analytics    |  | /api/dashboard/[role|  |
|  | Extract & Apply    |  | Submit & Verify    |  | Ingest & Reporting  |  | Role Gateways       |  |
|  +--------------------+  +--------------------+  +---------------------+  +---------------------+  |
+----------------------------------------------------------------------------------------------------+
          |                       |                           |                       |
          v                       v                           v                       v
+------------------+   +----------------------+   +----------------------+   +------------------+
|     MONGODB      |   | CERTIFICATE SERVICE  |   |     LLM SERVICE      |   |  PHOTO STORAGE   |
| (Atlas / Local)  |   |    (Port 3001)       |   |     (Port 8000)      |   | (Disk / S3 / R2) |
| - Users          |   | - Digital Signature  |   | - 60s PDF Extractor  |   | - Profile Photos |
| - StudentProfile |   | - University APIs    |   | - Structured JSON    |   | - Studio Assets  |
| - VisitingCards  |   | - Cryptographic Hash |   | - Review Staging     |   | - Magic Bytes Val|
| - WebsiteConfig  |   +----------------------+   +----------------------+   +------------------+
| - Revisions (DTO)|
| - AnalyticsEvents|
+------------------+
```

---

## 2. Global Communication & Networking Standards

### 2.1 Base URLs and Runtime Configuration
The frontend uses a global environment configuration object (`window.OV_ENV`):
```javascript
window.OV_ENV = {
  API_MODE: 'live',             // 'live' = call backend HTTP API; 'mock' = localStorage emulation
  API_BASE: 'http://localhost:3000/api',
  PUBLIC_BASE: 'onevue.id',
  STORAGE_PREFIX: 'onevue:',
};
```

### 2.2 Cross-Origin Resource Sharing (CORS) Policy
All API routes run `applyCorsHeaders` (or `preflightResponse` on `OPTIONS` requests).
- **Supported HTTP Methods:** `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- **Supported Headers:** `Content-Type, Authorization, X-Requested-With, X-Debug-Session-Id`
- **Credentials:** `Access-Control-Allow-Credentials: true`
- **Origin Reflection:** Dynamically reflects client origin if matching permitted local or production domains (`localhost:3000`, `localhost:5173`, `onevue.id`, etc.).

### 2.3 Common HTTP Status Codes & Error Envelope
All error responses adhere to a standardized JSON schema:
```json
{
  "message": "Human-readable explanation of the error",
  "code": "OPTIONAL_MACHINE_READABLE_CODE",
  "errors": {
    "fieldName": "Specific validation failure message"
  }
}
```

| HTTP Status | Meaning | Typical Trigger in OneVue |
|---|---|---|
| **200 OK** | Request succeeded | Successful GET, PUT, or non-creating POST. |
| **201 Created** | Resource created | Account registered, card created/duplicated, asset uploaded. |
| **202 Accepted** | Queued / Processed | Analytics event ingested or filtered. |
| **400 Bad Request** | Validation failed | Missing fields, invalid email, illegal username characters, malformed JSON. |
| **401 Unauthorized** | Missing / invalid token | Expired session, invalid JWT, or missing `Authorization: Bearer <token>`. |
| **403 Forbidden** | Privilege violation | Cross-account edit attempt, or accessing wrong role dashboard (e.g. Student accessing `/app/creator`). |
| **404 Not Found** | Resource missing | Card not found, user profile does not exist, unclaimed username. |
| **409 Conflict** | State conflict | Username already claimed, published card limit reached, duplicate email. |
| **413 Payload Too Large** | Size limit exceeded | Photo > 2 MB, Resume PDF > 10 MB, Analytics body > 8 KB. |
| **415 Unsupported Media** | Invalid MIME type | Uploading text file as image, or non-multipart upload. |
| **429 Too Many Requests** | Rate limit tripped | Analytics ingestion throttling, certificate retry throttle. |
| **500 Server Error** | Unhandled exception | Database failure or unhandled exception. |
| **503 Unavailable** | Subsystem down | Certificate service or LLM service unreachable. |

---

## 3. Authentication, Onboarding & User Profile Pipeline

### 3.1 Authentication & Token Lifecycle
Authentication uses standard **JSON Web Tokens (JWT)**.
- **Header format:** `Authorization: Bearer <token>`
- **Token lifespan:** `7 days`
- **JWT Claims Payload:**
```typescript
interface DecodedToken {
  id: string;               // MongoDB User ObjectId string
  email: string;            // User primary email
  identity?: IdentityType;  // 'student' | 'professional' | 'freelancer' | 'creator' | 'business'
  surveyCompleted: boolean; // true if discovery survey has been answered
  iat: number;
  exp: number;
}
```

### 3.2 Authentication Endpoints

#### 1. Register Account
- **Endpoint:** `POST /api/auth/register`
- **Auth:** Public
- **Request Body:**
```json
{
  "name": "Alex Mercer",
  "email": "alex@university.edu",
  "password": "SecurePassword123!",
  "identity": "student"
}
```
*(Valid identities: `"student"`, `"professional"`, `"freelancer"`, `"creator"`, `"business"`. Identity is optional at registration; if omitted, the user selects it during onboarding.)*
- **Success Response (`201 Created`):**
```json
{
  "message": "User created successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "6620f1a4e4b0123456789abc",
    "name": "Alex Mercer",
    "email": "alex@university.edu",
    "identity": "student",
    "onboarding": { "surveyCompleted": false, "survey": null }
  }
}
```
*Note: If `identity: "student"` is passed, the backend automatically seeds a clean, empty `StudentProfile` record.*

#### 2. User Login
- **Endpoint:** `POST /api/auth/login`
- **Auth:** Public
- **Request Body:**
```json
{
  "email": "alex@university.edu",
  "password": "SecurePassword123!"
}
```
- **Success Response (`200 OK`):**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "6620f1a4e4b0123456789abc",
    "name": "Alex Mercer",
    "email": "alex@university.edu",
    "identity": "student",
    "onboarding": { "surveyCompleted": true }
  }
}
```

#### 3. Session Validation / Me
- **Endpoint:** `GET /api/auth/me`
- **Auth:** `Bearer <token>`
- **Success Response (`200 OK`):** Returns authenticated user profile, identity, and onboarding status.

---

### 3.3 Onboarding State Machine & Route Guards

The frontend routing must implement this authoritative state-flow pipeline:

```
[User Registers / Logs In]
            |
            v
   Has Identity chosen?
       /        \
     (No)       (Yes)
     /            \
    v              v
Navigate to     Has Survey been completed?
/onboarding/          /               \
 identity           (No)              (Yes)
                    /                   \
                   v                     v
              Navigate to          Navigate to Canonical
              /onboarding/            Role Dashboard:
                survey            /app/:identity/overview
```

#### 1. Set Identity
- **Endpoint:** `POST /api/auth/set-identity`
- **Auth:** `Bearer <token>`
- **Request Body:**
```json
{ "identity": "student" }
```
- **Returns:** Refreshed JWT token containing the new `identity` claim and updated `user` object.

#### 2. Submit Discovery Survey
- **Endpoint:** `POST /api/auth/submit-survey`
- **Auth:** `Bearer <token>`
- **Allowed Discovery Sources:**
  `"google_search"`, `"instagram"`, `"youtube"`, `"linkedin"`, `"facebook"`, `"x_twitter"`, `"reddit"`, `"friend_family"`, `"college_university"`, `"online_advertisement"`, `"blog_article"`, `"developer_community"`, `"other"`
- **Request Body:**
```json
{
  "discoverySource": "college_university",
  "otherDetails": null
}
```
*(If `discoverySource: "other"`, `otherDetails` is mandatory, 1–500 characters).*
- **Returns:** Refreshed JWT token with `surveyCompleted: true`.

---

### 3.4 Core User Profile & Photo Pipeline

#### 1. Get Core Profile
- **Endpoint:** `GET /api/profile`
- **Auth:** `Bearer <token>`
- **Response:**
```json
{
  "user": {
    "id": "6620f1a4e4b0123456789abc",
    "name": "Alex Mercer",
    "email": "alex@university.edu",
    "username": "alexmercer",
    "identity": "student",
    "bio": "CS Major & Full-Stack Developer",
    "location": "San Francisco, CA",
    "profilePhotoKey": "users/6620f.../photo.jpg",
    "profilePhotoUrl": "/api/profile/photo/users%2F6620f...%2Fphoto.jpg",
    "profilePhotoUpdatedAt": "2026-10-26T10:00:00.000Z",
    "isEmailVerified": true,
    "surveyCompleted": true,
    "createdAt": "2026-10-01T08:00:00.000Z",
    "updatedAt": "2026-10-26T10:00:00.000Z"
  }
}
```

#### 2. Update Core Profile (Username Claiming & Bio)
- **Endpoint:** `PATCH /api/profile`
- **Auth:** `Bearer <token>`
- **Payload Rules:**
  - `name`: 1–100 characters.
  - `bio`: Max 500 characters (or `null` to clear).
  - `location`: Max 100 characters (or `null` to clear).
  - `username`: 3–30 characters, must start and end with an alphanumeric character, allowed symbols `.` `_` `-`, no consecutive symbols. Unique across the platform.

#### 3. Upload Profile Photo
- **Endpoint:** `POST /api/profile/photo`
- **Auth:** `Bearer <token>`
- **Content-Type:** `multipart/form-data`
- **Form Field:** `file` (Binary image)
- **Validation:**
  - Max size: `2 MB`
  - Magic byte verification: Strictly validates true JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), or WebP (`RIFF....WEBP`). Renaming `.exe` to `.png` will be rejected (`400 Bad Request`).
- **Response:**
```json
{
  "message": "Profile photo updated successfully.",
  "profilePhotoKey": "users/6620f.../photo.jpg",
  "profilePhotoUrl": "/api/profile/photo/users%2F6620f...%2Fphoto.jpg",
  "profilePhotoUpdatedAt": "2026-10-26T10:00:00.000Z"
}
```

#### 4. Delete Profile Photo
- **Endpoint:** `DELETE /api/profile/photo`
- **Auth:** `Bearer <token>`
- **Result:** Removes the file from storage and nulls `profilePhotoKey` and `profilePhotoUpdatedAt`.

#### 5. Change Password
- **Endpoint:** `POST /api/profile/change-password`
- **Auth:** `Bearer <token>`
- **Request Body:** `{ "currentPassword": "old", "newPassword": "newPassword123" }`

---

## 4. Multi-Role Domain Identity & Workspace Pipelines

### 4.1 Role Gateway & Dashboard Authorization
- **Endpoint:** `GET /api/dashboard/[role]`
- **Supported Roles:** `student`, `professional`, `freelancer`, `creator`, `business`
- **Auth:** `Bearer <token>`
- **Role Enforcement:** If a user with `identity: "student"` attempts to call `GET /api/dashboard/creator`, the backend returns `403 Forbidden` with:
```json
{
  "message": "Access denied. Your identity is 'student', but this dashboard is reserved for 'creator'.",
  "requiredRole": "creator",
  "userRole": "student"
}
```
The frontend route guard must immediately bounce the user to their designated dashboard (`/app/student`).

---

### 4.2 Student Identity Profile (`/api/student/profile`)
The student profile contains modular career, education, and portfolio data.

- **GET:** `GET /api/student/profile` (returns canonical student document).
- **PUT:** `PUT /api/student/profile` (saves draft profile; returns sanitized saved document).

#### Student Profile Data Modules:
1. **Personal Scalars:**
   - `preferredName`: string
   - `headline`: string (e.g., "Full-Stack Software Engineer")
   - `bio`: string
   - `dob`: string (YYYY-MM-DD)
   - `gender`: `"male"` | `"female"` | `"non-binary"` | `"prefer-not-to-say"` | `"other"`
   - `nationality`, `country`, `state`, `city`: string
   - `currentStatus`: string
   - `careerInterests`: `string[]`
   - `areasOfInterest`: `string[]`
   - `languages`: Array of `{ language: string, proficiency: "basic" | "conversational" | "fluent" | "native" }`
2. **Education (`education[]`):**
   - `id`: Unique client string ID (e.g., `"edu_abc123"`)
   - `institution`: string (required)
   - `institutionType`: `"school"` | `"junior_college"` | `"diploma_college"` | `"university"` | `"training_institution"` | `"other"`
   - `degree`: string (required)
   - `fieldOfStudy`, `specialization`, `department`: string
   - `startDate`, `endDate`, `expectedGradDate`: string
   - `currentStatus`: `"studying"` | `"completed"` | `"paused"` | `"withdrawn"`
   - `gpa`, `gpaScale`, `percentage`, `gradeClass`, `rank`: string
   - `location`, `website`, `rollNumber`: string
   - `coursework`, `honors`: string
   - `verificationStatus`: Server-controlled (`"self-reported"` | `"pending"` | `"verified"`)
3. **Projects (`projects[]`):**
   - `id`: string
   - `title`: string (required)
   - `shortDescription`, `detailedDescription`: string
   - `projectType`: `"academic"` | `"personal"` | `"hackathon"` | `"internship"` | `"research"` | `"open_source"` | `"freelance"` | `"startup"` | `"competition"` | `"other"`
   - `status`: `"planning"` | `"in_progress"` | `"completed"` | `"paused"` | `"archived"`
   - `role`: string
   - `isTeam`: boolean, `teamSize`: number, `teamMembers`: `string[]`
   - `technologies`: `string[]`
   - `repoUrl`, `liveUrl`, `docsUrl`, `videoUrl`: URLs (auto-prefixed with `https://`)
   - `problemSolved`, `keyFeatures`, `challengesSolutions`, `impact`: string
4. **Skills (`skills[]`):**
   - `id`: string
   - `name`: string
   - `category`: `"Programming Languages"` | `"Frontend"` | `"Backend"` | `"Databases"` | `"AI / ML"` | `"Cloud / DevOps"` | `"Tools"` | `"Other Skills"`
   - `proficiency`: `"Familiar"` | `"Beginner"` | `"Intermediate"` | `"Advanced"` | `"Expert"`
   - `yearsExperience`: number
5. **Credentials & Certifications (`credentials[]`):**
   - `id`: string
   - `title`: string
   - `credentialType`: `"certification"` | `"course_certificate"` | `"license"` | `"bootcamp"` | etc.
   - `issuer`: string
   - `issueDate`, `expirationDate`: string
   - `neverExpires`: boolean
   - `credentialUrl`, `verificationUrl`: string
   - `verificationStatus`: `"pending"` | `"verified"` | `"rejected"` | `"self-reported"`
   - `certificateVerificationId`: string (links to Certificate microservice)
6. **Achievements (`achievements[]`):**
   - `id`: string
   - `title`: string, `issuer`: string, `date`: string, `category`: string, `description`: string, `evidenceUrl`: string
7. **Media & Assets (`media[]`):**
   - Media showcase items with `title`, `mediaType` (`image`, `video`, `document`, `link`), `url`, and `thumbnailUrl`.
8. **Platform Links (`platformLinks[]`):**
   - `platform`: `"github"` | `"linkedin"` | `"leetcode"` | `"codeforces"` | `"kaggle"` | `"behance"` | `"dribbble"` | `"youtube"` | `"twitter"` | `"medium"` | `"personal_website"` | `"other"`
   - `url`: Validated URL
   - `username`: Optional handle

---

### 4.3 Other Domain Identity Endpoints
The platform implements identical contract patterns for all other domain identities:
- **Professional:** `GET /api/professional/profile` & `PUT /api/professional/profile`
- **Freelancer:** `GET /api/freelancer/profile` & `PUT /api/freelancer/profile`
- **Creator:** `GET /api/creator/profile` & `PUT /api/creator/profile`
- **Business:** `GET /api/business/profile` & `PUT /api/business/profile`

#### Frontend Sanitization Rule:
When submitting a `PUT` to any domain profile, the frontend must use the `buildUpdatePayload` helper to omit server-controlled identifiers:
```javascript
// DO NOT send:
delete payload.userId;
delete payload.ownerId;
delete payload._id;
// For sub-arrays (e.g. audienceStats, credentials):
delete item.verificationStatus;
delete item._id; // keep item.id
```

---

## 5. Visiting Card Studio End-to-End Pipeline

OneVue features a Canva-inspired Visiting Card Studio with multi-card persistence, double-sided (Front & Back) canvas editing, template discovery, and live 3D card preview.

### 5.1 Card Data Model & Specifications
- **Canvas Resolution:**
  - **Horizontal:** `1050 x 600 px` (Standard 3.5" x 2" @ 300 DPI aspect ratio).
  - **Vertical:** `600 x 1050 px`.
- **Maximum Elements:** `120` total elements across both Front and Back sides.
- **Publication Limit:** Maximum `3` published cards simultaneously per user account.

#### Design Document Structure:
```typescript
interface ICardDesignDocument {
  dimensions: {
    width: number;             // 1050
    height: number;            // 600
    orientation: 'horizontal' | 'vertical';
    unit: 'px';
  };
  front: {
    background: ICardBackground;
    elements: ICardElement[];
  };
  back: {
    background: ICardBackground;
    elements: ICardElement[];
  };
}

interface ICardBackground {
  type: 'solid' | 'gradient' | 'pattern' | 'image';
  color?: string;              // Hex string '#ffffff'
  gradient?: string;           // CSS linear-gradient string
  imageUrl?: string;
  opacity?: number;
}

interface ICardElement {
  id: string;                  // Unique string, e.g. 'el_photo_1'
  type: 'text' | 'photo' | 'logo' | 'qr' | 'social' | 'contact' | 'shape' | 'divider';
  x: number;                   // X coordinate in px (0-1050)
  y: number;                   // Y coordinate in px (0-600)
  width: number;
  height: number;
  rotation?: number;           // Degrees (0-360)
  zIndex: number;
  locked?: boolean;
  visible?: boolean;

  // Typography (type: 'text' | 'contact')
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  lineHeight?: number;

  // Media (type: 'photo' | 'logo')
  assetUrl?: string;
  assetKey?: string;
  borderRadius?: number;
  objectFit?: 'cover' | 'contain';
  borderWidth?: number;
  borderColor?: string;

  // QR Code (type: 'qr')
  targetUrl?: string;
  fgColor?: string;
  bgColor?: string;

  // Contact / Social Field (type: 'contact' | 'social')
  fieldKey?: string;           // 'email' | 'phone' | 'github' | 'linkedin' | 'website'
  label?: string;
  value?: string;
  icon?: string;
  url?: string;

  // Shapes (type: 'shape' | 'divider')
  shapeType?: 'rect' | 'circle' | 'pill' | 'divider';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}
```

---

### 5.2 Visiting Card Endpoints

#### 1. Load Visiting Cards & Active Studio Session
- **Endpoint:** `GET /api/student/card[?cardId=:id]`
- **Auth:** `Bearer <token>`
- **Behavior:**
  - If user has no cards yet, automatically seeds a default `"academic-classic"` card using the user's name, email, and university.
  - If `?cardId=...` is specified, loads that card as `card`; otherwise returns the user's default card.
- **Response:**
```json
{
  "success": true,
  "card": {
    "_id": "6620f1a4e4b0123456789abc",
    "designName": "Alex's Academic Card",
    "selectedTemplateId": "academic-classic",
    "publicationStatus": "draft",
    "isDefault": true,
    "designDocument": { ... },
    "assetReferences": [ ... ],
    "visibilitySettings": {
      "showEmail": true,
      "showPhone": true,
      "showSocials": true,
      "showPortfolioLink": true
    }
  },
  "cards": [
    {
      "_id": "6620f1a4e4b0123456789abc",
      "designName": "Alex's Academic Card",
      "selectedTemplateId": "academic-classic",
      "publicationStatus": "draft",
      "isDefault": true,
      "updatedAt": "2026-10-26T12:00:00.000Z",
      "designDocument": { ... }
    }
  ],
  "templates": [ ... ]
}
```

#### 2. Create or Duplicate Card
- **Endpoint:** `POST /api/student/card`
- **Auth:** `Bearer <token>`
- **Action A: Create Fresh Card from Template**
```json
{
  "action": "create",
  "templateId": "dev-dark",
  "designName": "My Developer Card"
}
```
*(Valid template IDs: `"academic-classic"`, `"dev-dark"`, `"minimal-clean"`, `"creative-bold"`, `"corporate-navy"`, `"freelance-warm"`, `"creator-vibrant"`, `"business-elite"`, `"modern-vertical"`)*.

- **Action B: Duplicate Existing Card**
```json
{
  "action": "duplicate",
  "sourceCardId": "6620f1a4e4b0123456789abc"
}
```
*(Creates a clone with `"(Copy)"` appended to the name in `"draft"` status).*

#### 3. Save Card Draft
- **Endpoint:** `PUT /api/student/card`
- **Auth:** `Bearer <token>`
- **Request Body:**
```json
{
  "cardId": "6620f1a4e4b0123456789abc",
  "designName": "Updated Card Name",
  "selectedTemplateId": "dev-dark",
  "isDefault": true,
  "designDocument": {
    "dimensions": { "width": 1050, "height": 600, "orientation": "horizontal", "unit": "px" },
    "front": { "background": { "type": "solid", "color": "#0f172a" }, "elements": [ ... ] },
    "back": { "background": { "type": "solid", "color": "#1e293b" }, "elements": [ ... ] }
  }
}
```

#### 4. Delete Card
- **Endpoint:** `DELETE /api/student/card?cardId=:id`
- **Auth:** `Bearer <token>`
- **Behavior:** Ensures the user cannot delete their last remaining card.

#### 5. Publish Card
- **Endpoint:** `POST /api/student/card/publish`
- **Auth:** `Bearer <token>`
- **Query/Body:** `cardId` (optional; defaults to the active card).
- **Behavior:**
  - Enforces the **3-published-card limit**. If limit reached, returns `400 Bad Request` with `code: "PUBLISHED_LIMIT_REACHED"`.
  - Takes the current draft `designDocument`, normalizes both sides, and freezes it into an immutable `publishedSnapshot`.
  - Marks `publicationStatus = "published"`, sets `publishedAt = new Date()`.
  - Marks this card as `isDefault = true` and unmarks other cards.
- **Response:**
```json
{
  "success": true,
  "message": "Visiting card published successfully!",
  "publicUrl": "onevue.id/card/alexmercer",
  "card": { ... }
}
```

#### 6. Unpublish Card
- **Endpoint:** `POST /api/student/card/unpublish`
- **Auth:** `Bearer <token>`
- **Query/Body:** `cardId`
- **Behavior:** Sets `publicationStatus = "unpublished"`. The public link immediately returns `404 Not Found`.

#### 7. Dynamic QR Code Generator
- **Endpoint:** `GET /api/student/card/qr?url=:targetUrl&format=svg|dataUrl&fg=:hex&bg=:hex&size=:px`
- **Auth:** Public
- **Parameters:**
  - `url` or `data`: The URL to encode (e.g., `https://onevue.id/card/alexmercer`).
  - `format`: `"svg"` (returns raw `image/svg+xml`) or `"dataUrl"` (returns JSON `{ success: true, dataUrl: "data:image/png;base64,..." }`).
  - `fg`, `bg`: Foreground/background hex colors (default: `#000000`, `#ffffff`).
  - `size`: Pixel dimension (80–800, default `250`).

#### 8. Upload Studio Asset (Logo / Photo)
- **Endpoint:** `POST /api/student/card/upload`
- **Auth:** `Bearer <token>`
- **Format:** `multipart/form-data`, field `file`. Max 2 MB, magic-byte validated.
- **Response:**
```json
{
  "success": true,
  "asset": {
    "key": "users/662.../asset_xyz.png",
    "publicUrl": "/api/profile/photo/users%2F662...%2Fasset_xyz.png",
    "name": "company_logo.png",
    "size": 45120,
    "mimeType": "image/png",
    "uploadedAt": "2026-10-26T12:30:00.000Z"
  }
}
```

#### 9. Public Visiting Card Fast-Path
- **Endpoint:** `GET /api/public/card/:username`
- **Auth:** Public / Unauthenticated
- **Behavior:**
  - Queries `VisitingCard` with `username: cleanUsername` and `publicationStatus: "published"`.
  - Delivers **exclusively** the frozen `publishedSnapshot` (never draft edits).
  - Attaches public user info and analytics configuration.
- **Response:**
```json
{
  "success": true,
  "card": {
    "username": "alexmercer",
    "design": {
      "dimensions": { "width": 1050, "height": 600, "orientation": "horizontal", "unit": "px" },
      "front": { "background": { ... }, "elements": [ ... ] },
      "back": { "background": { ... }, "elements": [ ... ] }
    },
    "selectedTemplateId": "dev-dark",
    "publishedAt": "2026-10-26T12:00:00.000Z",
    "visibilitySettings": { "showEmail": true, "showPhone": true, "showSocials": true, "showPortfolioLink": true },
    "user": { "name": "Alex Mercer", "identity": "student" },
    "analytics": {
      "resourceId": "6620f1a4e4b0123456789abc",
      "resourceType": "visiting_card"
    }
  }
}
```

---

## 6. Website & Portfolio Publishing Pipeline

The website builder creates a standalone personal website/portfolio (e.g. `onevue.id/p/alexmercer`).

```
[Student Profile Draft]  +  [Website Config]
            \                     /
             \                   /
          POST /api/student/website/publish
                         |
                         v
          +-------------------------------+
          | 1. Compile PublicProfileDTO   |
          | 2. Compute SHA-256 Checksum   |
          | 3. Create Immutable Revision  |
          | 4. Atomically Point Active ID |
          +-------------------------------+
                         |
                         v
       GET /api/public/profile/:username
           (Delivers Frozen DTO)
```

### 6.1 Endpoints

#### 1. Get Website Configuration
- **Endpoint:** `GET /api/student/website/config`
- **Auth:** `Bearer <token>`
- **Response:** Returns current configuration: `username`, `selectedTemplateId`, `selectedTemplateVersion`, `customization` (`accentColor`, `themeMode`, `visibleSections`), `status` (`"draft"` | `"published"` | `"suspended"`), `activeRevisionNumber`.

#### 2. Update Website Configuration
- **Endpoint:** `PUT /api/student/website/config`
- **Auth:** `Bearer <token>`
- **Rules:**
  - `username`: 3–30 chars, alphanumeric with `.` `_` `-`. Must be unique.
  - `selectedTemplateId`: Must be an approved template (e.g., `"magicui-portfolio"`, `"minimal-developer"`).
  - `customization`:
    - `accentColor`: Valid 3- or 6-digit hex string (e.g., `"#3b82f6"`).
    - `themeMode`: `"light"` | `"dark"` | `"system"`.
    - `visibleSections`: `string[]` (e.g. `["about", "education", "projects", "skills", "achievements", "contact"]`).
  - *Direct mutation of `activeRevisionId` or setting `status: "published"` via this PUT endpoint is strictly forbidden; publication requires the dedicated publish endpoint.*

#### 3. Live Draft Preview (Authenticated)
- **Endpoint:** `GET /api/student/website/preview`
- **Auth:** `Bearer <token>`
- **Behavior:** Compiles the student's live draft profile into a `PublicProfileDTO_v1` on the fly without publishing it. Cache-Control is strictly `private, no-cache, no-store`.

#### 4. Publish Website
- **Endpoint:** `POST /api/student/website/publish`
- **Auth:** `Bearer <token>`
- **Validation:**
  - Profile must have a valid display name.
  - Profile must have at least one completed section (headline, bio, education, project, or skill).
  - Website configuration must have a claimed `username`.
- **Atomic Operations:**
  1. Generates `PublicProfileDTO_v1`.
  2. Computes deterministic SHA-256 checksum of the DTO JSON string.
  3. Inserts an immutable `PublishedProfileRevision` record with `revisionNumber = latest + 1`.
  4. Atomically updates `UserWebsiteConfig`: sets `activeRevisionId = revision._id`, `status = "published"`, and `publishedAt = new Date()`.
- **Response:**
```json
{
  "success": true,
  "message": "Website published successfully.",
  "revision": {
    "id": "6620f999e4b0123456789def",
    "revisionNumber": 3,
    "templateId": "magicui-portfolio",
    "templateVersion": "1.0.0",
    "checksum": "a3f5c71d2e8b...",
    "publishedAt": "2026-10-26T13:00:00.000Z"
  },
  "publicUrl": "https://onevue.id/p/alexmercer"
}
```

#### 5. Revision History
- **Endpoint:** `GET /api/student/website/history`
- **Auth:** `Bearer <token>`
- **Response:** Lists all historical publication revisions for this user with `revisionNumber`, `publishedAt`, `checksum`, and `isActive: boolean`.

#### 6. Rollback to Prior Revision
- **Endpoint:** `POST /api/student/website/rollback`
- **Auth:** `Bearer <token>`
- **Request Body:** `{ "revisionNumber": 2 }` or `{ "revisionId": "6620..." }`
- **Behavior:** Atomically points `config.activeRevisionId` back to the chosen historical revision without altering or deleting other history entries.

#### 7. Public Portfolio Endpoint
- **Endpoint:** `GET /api/public/profile/:username`
- **Auth:** Public
- **Response:** Returns the frozen `dto` snapshot and public website layout settings.

---

## 7. Certificate Verification Service Pipeline

OneVue integrates with an independent digital certificate verification service (`http://localhost:3001`).

```
Frontend Client
     |
     | (1) POST /api/student/certificates { url: "https://coursera.org/verify/XYZ" }
     v
Next.js App Router (Authenticated with User JWT)
     |
     | (2) Forward to Certificate Verification Microservice (:3001)
     |     Headers: { Authorization: "Bearer CERTIFICATE_SERVICE_TOKEN" }
     v
Certificate Verification Microservice (:3001)
     |
     | (3) Verifies Issuer, Cryptographic Signatures, Expiry
     v
Next.js App Router
     |
     | (4) Upserts verified credential into StudentProfile.credentials[]
     v
Frontend Client (Receives verified certificate status & updates UI)
```

### 7.1 Endpoints

#### 1. Submit Certificate for Verification
- **Endpoint:** `POST /api/student/certificates`
- **Auth:** `Bearer <token>`
- **Request Body:**
```json
{
  "url": "https://coursera.org/verify/9ABCD1234XYZ"
}
```
- **Response (`200 OK` or `201 Created`):**
```json
{
  "created": true,
  "certificate": {
    "id": "cert_uuid_789",
    "url": "https://coursera.org/verify/9ABCD1234XYZ",
    "status": "verified",
    "issuer": "Coursera / Stanford Online",
    "title": "Machine Learning Specialization",
    "recipientName": "Alex Mercer",
    "issueDate": "2026-05-15",
    "verifiedAt": "2026-10-26T14:00:00.000Z"
  }
}
```
*Note: The backend automatically injects or updates this item inside the user's `StudentProfile.credentials` array with `verificationStatus = "verified"`.*

#### 2. Get Certificate Status
- **Endpoint:** `GET /api/student/certificates/:id`
- **Auth:** `Bearer <token>`
- **Response:** Returns current verification record and verification status (`"pending"` | `"verified"` | `"failed"`).

#### 3. Trigger Re-Verification
- **Endpoint:** `POST /api/student/certificates/:id/verify`
- **Auth:** `Bearer <token>`
- **Response:** Dispatches a re-verification check to the issuer.

---

## 8. Resume AI Extraction Pipeline (LLM Microservice)

The resume pipeline allows students to upload a PDF resume, runs structured LLM extraction via a dedicated Python service (`http://localhost:8000`), presents an interactive diff/review modal to the student, and selectively applies approved fields to their `StudentProfile`.

```
[Student Uploads PDF Resume]
            |
            v
POST /api/student/resume/extract
(Validates: multipart/form-data, size <= 10MB, '%PDF' header)
            |
            v
Dispatches to LLM Service (:8000)
(Extracts: name, education[], projects[], skills[], work[], bio)
            |
            v
Creates In-Memory / Staged Review Record (TTL = 15-30 mins)
Returns: { reviewId: "rev_abc123", extracted: { ... } }
            |
            v
Frontend Renders Interactive Diff / Selection Modal
            |
   +--------+--------+
   |                 |
(Student Approves)  (Student Cancels)
   |                 |
   v                 v
POST /api/student/  DELETE /api/student/
resume/apply        resume/reviews/:reviewId
   |                 |
Merges selected     Discards staged review
fields into
StudentProfile
```

### 8.1 Constraints & Timeouts
- **Route Timeout (`maxDuration`):** `120 seconds` (to prevent premature Next.js function termination).
- **LLM Service Timeout:** `60 seconds`.
- **Max File Size:** `10 MB` (enforced via `Content-Length` and buffer checks).
- **Magic Byte Validation:** First 1024 bytes must contain the `%PDF` signature.

### 8.2 Endpoints

#### 1. Extract Resume
- **Endpoint:** `POST /api/student/resume/extract`
- **Auth:** `Bearer <token>` (Student account only)
- **Format:** `multipart/form-data`, field `file`.
- **Response (`200 OK`):**
```json
{
  "reviewId": "rev_7f9b8c2d-...",
  "expiresAt": 1730000000000,
  "profile": {
    "headline": "Software Engineer & Distributed Systems Researcher",
    "bio": "Senior Computer Science student at Stanford...",
    "education": [
      {
        "id": "ext_edu_1",
        "institution": "Stanford University",
        "degree": "B.S. in Computer Science",
        "startDate": "2023-09",
        "expectedGradDate": "2027-06",
        "gpa": "3.92",
        "currentStatus": "studying"
      }
    ],
    "skills": [
      { "id": "ext_sk_1", "name": "TypeScript", "category": "Programming Languages", "proficiency": "Advanced" },
      { "id": "ext_sk_2", "name": "Go", "category": "Programming Languages", "proficiency": "Intermediate" },
      { "id": "ext_sk_3", "name": "MongoDB", "category": "Databases", "proficiency": "Intermediate" }
    ],
    "projects": [
      {
        "id": "ext_proj_1",
        "title": "OneVue Distributed Platform",
        "shortDescription": "Multi-tenant portfolio engine with microservice architecture",
        "technologies": ["Next.js", "MongoDB", "Python"]
      }
    ]
  }
}
```

#### 2. Get Staged Review Draft
- **Endpoint:** `GET /api/student/resume/reviews/:reviewId`
- **Auth:** `Bearer <token>`
- **Response:** Returns the active staged review payload. If expired or already consumed, returns `404 Not Found`.

#### 3. Apply Extracted Resume Fields
- **Endpoint:** `POST /api/student/resume/apply`
- **Auth:** `Bearer <token>`
- **Request Body:**
```json
{
  "reviewId": "rev_7f9b8c2d-...",
  "selectedFields": {
    "headline": true,
    "bio": true,
    "education": ["ext_edu_1"],
    "skills": ["ext_sk_1", "ext_sk_2", "ext_sk_3"],
    "projects": ["ext_proj_1"]
  }
}
```
*(The student can toggle which sections or specific sub-items to import).*
- **Behavior:** Safely merges selected records into `StudentProfile`. Each student has exactly **one** canonical resume slot. Returns the updated profile.

#### 4. Discard Staged Review
- **Endpoint:** `DELETE /api/student/resume/reviews/:reviewId`
- **Auth:** `Bearer <token>`
- **Response:** `{ "discarded": true }`

---

## 9. Analytics Ingestion & Reporting Pipeline

OneVue features privacy-first, server-side verified analytics. There are two distinct channel types:
1. **Public Event Ingestion (`POST /api/analytics/events`):** High-throughput, zero-auth, rate-limited, bot-filtered endpoint called by public visitor browsers.
2. **Private Owner Reporting (`GET /api/analytics/*`):** Authenticated endpoints delivering aggregations, timeseries, and CSV exports to resource owners.

```
+-------------------------------------------------------------------------------+
|                             PUBLIC INGESTION CHANNEL                          |
| (Called by Public Card: onevue.id/card/:user & Public Portfolio: onevue.id/p) |
+-------------------------------------------------------------------------------+
                                       |
                                       | POST /api/analytics/events (No Auth)
                                       v
                     +-----------------------------------+
                     | 1. Rate Limiting Check            |
                     | 2. Max Payload Check (<= 8 KB)    |
                     | 3. Bot & Prefetch Filtering       |
                     | 4. Verify Resource Exists/Pub     |
                     | 5. Sanitize (Drop ownerId, IP)    |
                     +-----------------------------------+
                                       |
                                       v
                            [AnalyticsEvents Collection]
                                       |
                                       v
+-------------------------------------------------------------------------------+
|                            PRIVATE REPORTING CHANNEL                          |
|                (Called by Student/Creator Analytics Dashboard)                |
|                    GET /api/analytics/overview (Bearer JWT)                   |
|                    GET /api/analytics/resources/:id (Bearer JWT)              |
+-------------------------------------------------------------------------------+
```

### 9.1 Public Event Ingestion

- **Endpoint:** `POST /api/analytics/events`
- **Auth:** Public / Unauthenticated
- **Max Body Size:** `8192 bytes` (8 KB)
- **Rate Limit:** Built-in in-process token bucket (returns `429 Too Many Requests` with `Retry-After`).
- **Request Body:**
```json
{
  "sdkVersion": "1",
  "eventId": "evt_abc123_unique",
  "resourceId": "6620f1a4e4b0123456789abc",
  "resourceType": "visiting_card",
  "eventType": "page_view",
  "path": "/card/alexmercer",
  "referrer": "https://linkedin.com",
  "consent": true,
  "visitorId": "vis_random_anon_id",
  "sessionId": "ses_random_anon_id",
  "metadata": {
    "viewportWidth": 1440,
    "viewportHeight": 900
  }
}
```
*(Security rules: `ownerId` and `occurredAt` are ignored if provided by the client. The server assigns the verified resource owner and current timestamp).*

- **Response:**
  - `202 Accepted`: Event accepted, deduped, or filtered.
  - `400 Bad Request`: Invalid SDK version or event type.
  - `404 Not Found`: Unknown or unpublished resource ID.

---

### 9.2 Private Reporting Endpoints (Authenticated)

All reporting endpoints require `Authorization: Bearer <token>` and return `Cache-Control: private, no-store`.

#### Query Parameters Supported on All Reporting Routes:
- `from`: ISO timestamp or date (`2026-10-01`)
- `to`: ISO timestamp or date (`2026-10-26`)
- `timezone`: IANA timezone string (e.g. `"America/New_York"`, `"Asia/Kolkata"`). Defaults to `"UTC"`.
- `compare`: `"true"` (default) or `"false"` (compares against previous equal period).

#### Reporting Routes:
1. **Global Overview:**
   - `GET /api/analytics/overview[?type=all|portfolio|visiting_card][&resourceId=...]`
   - Returns: `totals` (views, unique visitors, clicks, downloads, avg duration), `timeseries` buckets, `audience` (devices, browsers, OS, countries), `sources` (referrer domains, UTM campaigns), `recentEvents`.
2. **List Owned Resources:**
   - `GET /api/analytics/resources`
   - Returns a list of all cards and portfolios owned by the caller with summary metrics.
3. **Single Resource Totals:**
   - `GET /api/analytics/resources/:resourceId`
4. **Timeseries Data:**
   - `GET /api/analytics/resources/:resourceId/timeseries`
   - Returns zero-filled date buckets suitable for charting (Recharts, Chart.js).
5. **Audience Breakdown:**
   - `GET /api/analytics/resources/:resourceId/audience`
   - Breakdown by Device (mobile, desktop, tablet), OS, Browser, and Country.
6. **Traffic Sources:**
   - `GET /api/analytics/resources/:resourceId/sources`
   - Top referring domains and campaign attribution.
7. **Paginated Raw Events:**
   - `GET /api/analytics/resources/:resourceId/events?page=1&pageSize=20`
   - Max `pageSize = 50`. Offsets above 1000 are rejected for database health.
8. **Export Data:**
   - `GET /api/analytics/resources/:resourceId/export?format=csv` (triggers direct CSV file download).
   - `GET /api/analytics/resources/:resourceId/export?format=json` (returns raw export payload).

---

## 10. Frontend Integration Architecture & Developer Guide

### 10.1 Live HTTP Client Architecture
In `frontend/services/_core.js`, the live HTTP client transparently injects session tokens and parses JSON:

```javascript
/* Standard API Caller in frontend/services/ */
async function callApi(method, path, body = null, isFormData = false) {
  const env = window.OV_ENV;
  const session = JSON.parse(localStorage.getItem(env.STORAGE_PREFIX + 'session') || 'null');
  
  const headers = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (session && session.token) {
    headers['Authorization'] = 'Bearer ' + session.token;
  }

  const res = await fetch(env.API_BASE.replace(/\/$/, '') + path, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    credentials: 'include',
  });

  if (!res.ok) {
    let errBody = {};
    try { errBody = await res.json(); } catch (_) {}
    const error = new Error(errBody.message || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.code = errBody.code;
    error.errors = errBody.errors;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}
```

---

### 10.2 Frontend Route Map & Canonical Paths

The React frontend uses standard canonical dashboard routes:

| Route Path | View / Component | Guard / Preconditions |
|---|---|---|
| `/` | `Landing.jsx` / Landing Page | Public |
| `/#/card/:username` | `PublicVisitingCard.jsx` | Public (Unauthenticated) |
| `/#/p/:username` | Public Portfolio View | Public (Unauthenticated) |
| `/#/onboarding/identity` | `IdentityOnboardingPage.jsx` | Session exists, `user.identity` is null |
| `/#/onboarding/survey` | `SurveyOnboardingPage.jsx` | Session exists, `surveyCompleted: false` |
| `/#/dashboard` | `DashboardRedirect.jsx` | Redirects to `/app/:identity/overview` |
| `/#/app/student/overview` | `StudentOverviewPage.jsx` | Protected (`role === 'student'`) |
| `/#/app/student/profile` | `StudentProfilePage.jsx` | Protected (`role === 'student'`) |
| `/#/app/student/visiting-card/overview` | "My Cards" Gallery | Protected (`role === 'student'`) |
| `/#/app/student/visiting-card/templates` | Template Discovery Catalog | Protected (`role === 'student'`) |
| `/#/app/student/visiting-card/studio/new` | Canvas Studio (New Draft) | Protected (`role === 'student'`) |
| `/#/app/student/visiting-card/studio/:cardId` | Canvas Studio (Active Editor) | Protected (`role === 'student'`) |
| `/#/app/student/website` | Website / Portfolio Builder | Protected (`role === 'student'`) |
| `/#/app/student/website/preview` | Live Portfolio Preview | Protected (`role === 'student'`) |
| `/#/app/student/analytics` | `StudentAnalyticsPage.jsx` | Protected (`role === 'student'`) |
| `/#/app/professional/*` | `ProfessionalDashboard.jsx` | Protected (`role === 'professional'`) |
| `/#/app/freelancer/*` | `FreelancerDashboard.jsx` | Protected (`role === 'freelancer'`) |
| `/#/app/creator/*` | `CreatorDashboard.jsx` | Protected (`role === 'creator'`) |
| `/#/app/business/*` | `BusinessDashboard.jsx` | Protected (`role === 'business'`) |

---

### 10.3 Frontend State Reducer Contract (Profile Editor)

To ensure smooth saving and avoid race conditions, domain profile forms should use the established reducer pattern (`frontend/services/identity-profile-state.js`):

```javascript
// State transitions
load_start   -> { loading: true, error: null }
load_success -> { loading: false, profile: data, draft: deepClone(data) }
load_error   -> { loading: false, error: message }
update_field -> { draft: { ...draft, [field]: value } }
save_start   -> { saving: true, saveError: null, notice: '' }
save_success -> { saving: false, profile: data, draft: deepClone(data), notice: 'saved' }
save_error   -> { saving: false, saveError: message, notice: '' }
```
*Rule: Never show a success toast on `save_error`. Only show positive feedback when `save_success` is dispatched.*

---

## 11. Master Endpoint Quick-Reference Sheet

| HTTP Method | Route URL | Auth Required | Purpose / Notes |
|---|---|---|---|
| **POST** | `/api/auth/register` | No | Creates new account, seeds initial profile |
| **POST** | `/api/auth/login` | No | Returns JWT session token |
| **GET** | `/api/auth/me` | Yes | Validates active session token |
| **POST** | `/api/auth/set-identity` | Yes | Sets user role (`student`, `creator`, etc.) |
| **POST** | `/api/auth/submit-survey` | Yes | Submits discovery survey |
| **GET** | `/api/profile` | Yes | Gets basic profile info & photo URLs |
| **PATCH** | `/api/profile` | Yes | Updates name, bio, location, claims username |
| **POST** | `/api/profile/photo` | Yes (Multipart) | Uploads profile photo (max 2MB, magic bytes) |
| **DELETE**| `/api/profile/photo` | Yes | Deletes active profile photo |
| **POST** | `/api/profile/change-password` | Yes | Changes password |
| **GET** | `/api/dashboard/:role` | Yes | Role-gated dashboard configuration |
| **GET** | `/api/student/profile` | Yes | Fetches full modular student profile |
| **PUT** | `/api/student/profile` | Yes | Saves full modular student profile draft |
| **GET** | `/api/student/card` | Yes | Gets active card, cards list, and 9 templates |
| **POST** | `/api/student/card` | Yes | Creates new card or duplicates (`action: 'duplicate'`) |
| **PUT** | `/api/student/card` | Yes | Saves double-sided visiting card draft |
| **DELETE**| `/api/student/card?cardId=...` | Yes | Deletes visiting card |
| **POST** | `/api/student/card/publish` | Yes | Freezes draft into public snapshot (max 3) |
| **POST** | `/api/student/card/unpublish` | Yes | Inactivates public card link |
| **GET** | `/api/student/card/qr` | No | Generates SVG or DataURL QR code |
| **POST** | `/api/student/card/upload` | Yes (Multipart) | Uploads card logo/asset (max 2MB) |
| **GET** | `/api/public/card/:username` | No | Public frozen visiting card fast path |
| **GET** | `/api/student/website/config` | Yes | Gets personal website/portfolio configuration |
| **PUT** | `/api/student/website/config` | Yes | Updates theme, username, and visible sections |
| **GET** | `/api/student/website/preview` | Yes | Generates live unreleased DTO preview |
| **POST** | `/api/student/website/publish` | Yes | Computes SHA-256, writes revision snapshot |
| **GET** | `/api/student/website/history` | Yes | Returns publication revision history |
| **POST** | `/api/student/website/rollback` | Yes | Reverts active public website to prior revision |
| **GET** | `/api/public/profile/:username` | No | Public frozen portfolio fast path |
| **POST** | `/api/student/certificates` | Yes | Submits certificate credential to microservice |
| **GET** | `/api/student/certificates/:id`| Yes | Checks verification status |
| **POST** | `/api/student/certificates/:id/verify` | Yes | Triggers certificate re-verification |
| **POST** | `/api/student/resume/extract` | Yes (Multipart) | Uploads PDF (max 10MB) to LLM extraction service |
| **GET** | `/api/student/resume/reviews/:id` | Yes | Fetches staged extraction review draft |
| **POST** | `/api/student/resume/apply` | Yes | Applies approved resume fields to profile |
| **DELETE**| `/api/student/resume/reviews/:id` | Yes | Discards staged resume review |
| **POST** | `/api/analytics/events` | No | Ingests public visitor event (bot & rate-limited) |
| **GET** | `/api/analytics/overview` | Yes | Owner aggregated analytics overview |
| **GET** | `/api/analytics/resources` | Yes | Owner resource list with metrics |
| **GET** | `/api/analytics/resources/:id` | Yes | Specific resource metric totals |
| **GET** | `/api/analytics/resources/:id/timeseries` | Yes | Bucketized timeseries data |
| **GET** | `/api/analytics/resources/:id/audience` | Yes | Device, OS, browser, country breakdown |
| **GET** | `/api/analytics/resources/:id/sources` | Yes | Referrers and campaign tracking |
| **GET** | `/api/analytics/resources/:id/events` | Yes | Paginated raw event stream |
| **GET** | `/api/analytics/resources/:id/export` | Yes | CSV / JSON analytics export |
