# OneVue — Complete Backend Pipeline Architecture Flowchart & Visual Design Guide

> **Document Type:** Visual Architecture & Engineering Flowcharts  
> **Target Audience:** Frontend Developers, System Architects & UI/UX Engineers  
> **Companion Document:** [BACKEND_ARCHITECTURE_FRONTEND_SPEC.md](file:///c:/Users/srivv/Downloads/Telegram%20Desktop/company_project/docs/BACKEND_ARCHITECTURE_FRONTEND_SPEC.md)  
> **Status:** Production Reference  

---

## Table of Contents

1. [Master System Architecture & Dataflow Flowchart](#1-master-system-architecture--dataflow-flowchart)
2. [Authentication, Onboarding & Route Guard Flowchart](#2-authentication-onboarding--route-guard-flowchart)
3. [Core Profile & Media Asset Upload Flowchart](#3-core-profile--media-asset-upload-flowchart)
4. [Multi-Domain Tenancy & Workspace Routing Flowchart](#4-multi-domain-tenancy--workspace-routing-flowchart)
5. [Canva-Style Visiting Card Studio Pipeline Flowchart](#5-canva-style-visiting-card-studio-pipeline-flowchart)
6. [Website & Portfolio Publishing & Rollback Pipeline Flowchart](#6-website--portfolio-publishing--rollback-pipeline-flowchart)
7. [Digital Certificate Verification Microservice Sequence Flowchart](#7-digital-certificate-verification-microservice-sequence-flowchart)
8. [Resume AI Extraction & Review Staging Sequence Flowchart](#8-resume-ai-extraction--review-staging-sequence-flowchart)
9. [Analytics Ingestion & Reporting Dual-Pipeline Flowchart](#9-analytics-ingestion--reporting-dual-pipeline-flowchart)
10. [Frontend Service Layer & Reducer State Transition Flowchart](#10-frontend-service-layer--reducer-state-transition-flowchart)

---

## 1. Master System Architecture & Dataflow Flowchart

This master diagram depicts the complete end-to-end topology connecting the React Frontend SPA, the Next.js 16 App Router backend, external microservices, and persistent databases.

```mermaid
flowchart TD
    subgraph CLIENT["Frontend Client (React SPA)"]
        UI["User Interface Components"]
        STATE["Client State / Service Layer"]
        SDK["Analytics SDK Collector"]
        STORE["Local Storage (JWT & Session)"]
    end

    subgraph GATEWAY["Ingress & Next.js 16 API Boundary (Port 3000)"]
        CORS["CORS & Preflight Handler"]
        AUTH_MW["JWT Authentication & VerifyAuth"]
        SAN["Input Validation & Sanitization"]
    end

    subgraph ROUTERS["API Domain Handlers"]
        AUTH_API["/api/auth/*"]
        PROFILE_API["/api/profile & /api/profile/photo"]
        CARD_API["/api/student/card/*"]
        SITE_API["/api/student/website/*"]
        CERT_API["/api/student/certificates/*"]
        RESUME_API["/api/student/resume/*"]
        ANALYTICS_API["/api/analytics/*"]
        PUB_API["/api/public/* (Fast Path)"]
    end

    subgraph MICROSERVICES["Auxiliary Microservices"]
        CERT_SVC["Certificate Verification Service (:3001)"]
        LLM_SVC["LLM Resume Extraction Service (:8000)"]
        STORAGE_SVC["Photo & Asset File Store (Local / Cloud)"]
    end

    subgraph DATABASE["Database Layer (MongoDB)"]
        COLL_USERS[("Users Collection")]
        COLL_STUDENT[("StudentProfile Collection")]
        COLL_CARDS[("VisitingCards Collection")]
        COLL_SITE[("UserWebsiteConfig Collection")]
        COLL_REVS[("PublishedProfileRevisions (Immutable DTO)")]
        COLL_EVENTS[("AnalyticsEvents Collection")]
    end

    UI --> STATE
    STATE <--> STORE
    STATE --> SDK
    STATE -- "HTTP Requests + Bearer JWT" --> CORS
    SDK -- "POST /api/analytics/events (No Auth)" --> CORS
    CORS --> AUTH_MW
    AUTH_MW --> SAN

    SAN --> AUTH_API
    SAN --> PROFILE_API
    SAN --> CARD_API
    SAN --> SITE_API
    SAN --> CERT_API
    SAN --> RESUME_API
    SAN --> ANALYTICS_API
    CORS --> PUB_API

    AUTH_API <--> COLL_USERS
    PROFILE_API <--> COLL_USERS
    PROFILE_API <--> STORAGE_SVC
    CARD_API <--> COLL_CARDS
    CARD_API <--> STORAGE_SVC
    SITE_API <--> COLL_SITE
    SITE_API <--> COLL_REVS
    SITE_API <--> COLL_STUDENT

    CERT_API <--> CERT_SVC
    CERT_API --> COLL_STUDENT

    RESUME_API <--> LLM_SVC
    RESUME_API --> COLL_STUDENT

    ANALYTICS_API <--> COLL_EVENTS
    PUB_API <--> COLL_CARDS
    PUB_API <--> COLL_REVS
```

---

## 2. Authentication, Onboarding & Route Guard Flowchart

Every user transitions through a strict 3-tier onboarding pipeline before gaining access to their role-specific dashboard.

```mermaid
flowchart TD
    START(["User Navigates to Application"]) --> IS_AUTH{"Session Token in LocalStorage?"}

    IS_AUTH -- "No" --> PUBLIC_VIEW["Render Landing Page (/) & Auth Modal"]
    IS_AUTH -- "Yes" --> CALL_ME["GET /api/auth/me (Validate JWT)"]

    CALL_ME -- "Token Expired / Invalid (401)" --> CLEAR_SESSION["Purge Session Storage"] --> PUBLIC_VIEW
    CALL_ME -- "Token Valid (200)" --> HAS_IDENTITY{"user.identity Selected?"}

    HAS_IDENTITY -- "No" --> NAV_IDENTITY["Redirect to /#/onboarding/identity"]
    NAV_IDENTITY --> SELECT_IDENTITY["User Picks Identity (Student, Creator, etc.)"]
    SELECT_IDENTITY --> POST_IDENTITY["POST /api/auth/set-identity"]
    POST_IDENTITY --> REFRESH_JWT_1["Save New JWT & User Object"] --> HAS_SURVEY

    HAS_IDENTITY -- "Yes" --> HAS_SURVEY{"onboarding.surveyCompleted == true?"}

    HAS_SURVEY -- "No" --> NAV_SURVEY["Redirect to /#/onboarding/survey"]
    NAV_SURVEY --> SUBMIT_SURVEY["User Submits Discovery Source"]
    SUBMIT_SURVEY --> POST_SURVEY["POST /api/auth/submit-survey"]
    POST_SURVEY --> REFRESH_JWT_2["Save Refreshed JWT (surveyCompleted=true)"] --> CHECK_ROUTE

    HAS_SURVEY -- "Yes" --> CHECK_ROUTE{"Route Matches user.identity?"}

    CHECK_ROUTE -- "Wrong Identity (e.g. Student visits /app/creator)" --> REDIRECT_ROLE["Toast Info & Redirect to /app/:identity/overview"]
    CHECK_ROUTE -- "Exact Identity Match" --> LOAD_DASHBOARD["Mount Role Protected Dashboard (e.g. /app/student/overview)"]
```

---

## 3. Core Profile & Media Asset Upload Flowchart

This pipeline illustrates how user metadata (bio, username claiming) and binary images (profile photos) are validated and stored.

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant Frontend as Frontend Profile Page
    participant API as Next.js API (/api/profile/photo)
    participant Storage as Photo Storage Engine
    participant DB as MongoDB (Users)

    Note over User,DB: Photo Upload & Magic Bytes Validation Pipeline
    User->>Frontend: Selects Image File (avatar.png)
    Frontend->>Frontend: Client Check (file.size <= 2MB)
    Frontend->>API: POST /api/profile/photo (multipart/form-data)
    Note right of API: Bearer JWT Authentication
    API->>API: 1. Content-Length <= 2 MB Check
    API->>API: 2. Magic Bytes Inspection (JPEG: FF D8 FF | PNG: 89 50 4E 47 | WebP: RIFF..WEBP)
    alt Magic Bytes Mismatch or Fake MIME
        API-->>Frontend: 400 Bad Request ("Invalid image format")
        Frontend-->>User: Toast Error Alert
    else Valid Magic Bytes
        API->>Storage: upload(buffer, mimeType, userId)
        Storage-->>API: { key: "users/123/avatar.png", publicUrl: "/api/profile/photo/..." }
        API->>DB: Update User { profilePhotoKey, profilePhotoUpdatedAt }
        opt If previous photo exists
            API->>Storage: delete(oldProfilePhotoKey)
        end
        DB-->>API: Save Confirmed
        API-->>Frontend: 200 OK { profilePhotoUrl, profilePhotoUpdatedAt }
        Frontend-->>User: Update Avatar UI & Success Toast
    end
```

---

## 4. Multi-Domain Tenancy & Workspace Routing Flowchart

OneVue serves 5 distinct professional personas from a single code base with guaranteed tenant role isolation.

```mermaid
flowchart LR
    subgraph INGRESS["Session Router (/dashboard)"]
        USER_ID["Read session.user.identity"]
    end

    subgraph GATEWAYS["Authorization Gateways (/api/dashboard/[role])"]
        GW_STUDENT["Verify identity == 'student'"]
        GW_PROF["Verify identity == 'professional'"]
        GW_FREE["Verify identity == 'freelancer'"]
        GW_CREAT["Verify identity == 'creator'"]
        GW_BIZ["Verify identity == 'business'"]
    end

    subgraph DASHBOARDS["Role Workspaces"]
        D_STUDENT["Student Workspace<br>• Academics & GPA<br>• Projects & Hackathons<br>• Verified Certificates<br>• Double-Sided Student Card"]
        D_PROF["Professional Workspace<br>• Career Experience<br>• Corporate Roles<br>• Recruiter Views"]
        D_FREE["Freelancer Workspace<br>• Services & Rates<br>• Client Testimonials<br>• Client OneVue Link"]
        D_CREAT["Creator Workspace<br>• Media Kits & Niches<br>• Audience Analytics<br>• Platform Metrics"]
        D_BIZ["Business Workspace<br>• Company Registration<br>• Products & Catalogs<br>• Partnership Decks"]
    end

    USER_ID -->|identity='student'| GW_STUDENT --> D_STUDENT
    USER_ID -->|identity='professional'| GW_PROF --> D_PROF
    USER_ID -->|identity='freelancer'| GW_FREE --> D_FREE
    USER_ID -->|identity='creator'| GW_CREAT --> D_CREAT
    USER_ID -->|identity='business'| GW_BIZ --> D_BIZ
```

---

## 5. Canva-Style Visiting Card Studio Pipeline Flowchart

The Visiting Card pipeline supports dual-sided canvas editing, template seeding, multi-card duplication, and atomic publication with frozen snapshots.

```mermaid
flowchart TD
    subgraph DISCOVERY["1. Template Discovery & Seeding"]
        T_CATALOG["Template Catalog (9 Templates / 9 Categories)"]
        SEED["Seed Profile Data (Name, School, Email, Socials)"]
        T_CATALOG -->|User selects template| SEED
    end

    subgraph STUDIO["2. Double-Sided Studio Editor"]
        CANVAS["Canvas Engine (1050x600 px Horizontal / 600x1050 px Vertical)"]
        FLIP["Side Switcher: Front Side <---> Back Side"]
        ELEMENTS["Elements Panel (Text, Photos, Shapes, QR, Icons, Contact)"]
        LAYERS["Layer Controls (z-Index, Lock, Hide, Alignment)"]
        
        SEED --> CANVAS
        CANVAS <--> FLIP
        ELEMENTS --> CANVAS
        LAYERS --> CANVAS
    end

    subgraph PERSISTENCE["3. Draft Persistence"]
        AUTOSAVE["Autosave / Manual Save (PUT /api/student/card)"]
        CARD_DOC["Normalized Dual-Sided JSON Document"]
        CANVAS --> AUTOSAVE --> CARD_DOC
    end

    subgraph PUBLICATION["4. Publication & Limit Check"]
        REQ_PUB["Publish Request (POST /api/student/card/publish)"]
        CHECK_PUB{"Published Cards Count >= 3?"}
        PUB_ERR["400 Error: PUBLISHED_LIMIT_REACHED"]
        FREEZE["Freeze Draft into Immutable publishedSnapshot"]
        SET_DEFAULT["Mark isDefault = true"]
        PUB_OK["200 OK: Public URL Active (onevue.id/card/:username)"]

        CARD_DOC --> REQ_PUB --> CHECK_PUB
        CHECK_PUB -- "Yes" --> PUB_ERR
        CHECK_PUB -- "No" --> FREEZE --> SET_DEFAULT --> PUB_OK
    end

    subgraph PUBLIC_DELIVERY["5. Public Delivery & 3D Viewer"]
        PUB_REQ["Public Visitor visits onevue.id/card/:username"]
        SERVE_PUB["GET /api/public/card/:username"]
        THREE_D["Interactive 3D Flipping Card UI (Front/Back)"]
        TRACK_EVT["OneVueAnalytics SDK emits 'page_view'"]

        PUB_OK -.-> PUB_REQ --> SERVE_PUB --> THREE_D --> TRACK_EVT
    end
```

---

## 6. Website & Portfolio Publishing & Rollback Pipeline Flowchart

Drafts in the website builder are completely isolated from public viewers until an atomic publication revision is committed.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Student / Creator
    participant Frontend as Website Builder UI
    participant Backend as Next.js API (/api/student/website/*)
    participant DB as MongoDB Collections
    actor Visitor as Public Web Visitor

    Note over Dev,Backend: Phase A: Draft Editing & Instant Preview
    Dev->>Frontend: Edits Theme, Accent Color, Visible Sections
    Frontend->>Backend: PUT /api/student/website/config
    Backend->>DB: Save to UserWebsiteConfig (Status remains 'draft')
    Backend-->>Frontend: 200 OK (Draft Saved)

    Dev->>Frontend: Clicks 'Preview Site'
    Frontend->>Backend: GET /api/student/website/preview (Authenticated)
    Backend->>Backend: Compile live StudentProfile into PublicProfileDTO_v1
    Backend-->>Frontend: 200 OK { preview: true, dto: {...} }
    Frontend->>Dev: Renders Live Unreleased Portfolio Preview

    Note over Dev,DB: Phase B: Publication & SHA-256 Checksumming
    Dev->>Frontend: Clicks 'Publish to Web'
    Frontend->>Backend: POST /api/student/website/publish
    Backend->>Backend: 1. Validate display name & required content
    Backend->>Backend: 2. Compile PublicProfileDTO_v1
    Backend->>Backend: 3. Compute deterministic SHA-256 Checksum
    Backend->>DB: 4. Insert PublishedProfileRevision (revisionNumber = n + 1)
    Backend->>DB: 5. Atomically update UserWebsiteConfig (activeRevisionId = revision._id, status='published')
    Backend-->>Frontend: 200 OK { publicUrl: "onevue.id/p/alex", revisionNumber: 3, checksum }
    Frontend->>Dev: Show Success Notice & Public URL Link

    Note over Visitor,DB: Phase C: Public Viewer Fast-Path
    Visitor->>Backend: GET /api/public/profile/alex
    Backend->>DB: Find active revision via config.activeRevisionId
    DB-->>Backend: Return frozen snapshot
    Backend-->>Visitor: 200 OK (Frozen DTO Snapshot)
    Note over Visitor: Never hits live draft profile; zero leak of unpublished edits

    Note over Dev,DB: Phase D: Atomic Rollback to Prior Revision
    Dev->>Frontend: Selects Revision #1 in History & Clicks 'Rollback'
    Frontend->>Backend: POST /api/student/website/rollback { revisionNumber: 1 }
    Backend->>DB: Find Revision #1 belonging to this user
    Backend->>DB: Atomically point UserWebsiteConfig.activeRevisionId to Revision #1
    Backend-->>Frontend: 200 OK (Rolled back to Revision #1)
    Frontend->>Dev: Live Public Site immediately reflects Revision #1
```

---

## 7. Digital Certificate Verification Microservice Sequence Flowchart

Shows the delegation from the main Next.js backend to the Certificate Verification service running on port 3001.

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student
    participant UI as Frontend Credential Page
    participant NextAPI as Next.js API (/api/student/certificates)
    participant CertService as Certificate Microservice (:3001)
    participant Issuer as University / Coursera / edX
    participant DB as MongoDB (StudentProfile)

    Student->>UI: Pastes Credential URL & Clicks 'Verify'
    UI->>NextAPI: POST /api/student/certificates { url: "https://coursera.org/verify/XYZ" }
    Note right of NextAPI: 1. Validate JWT session token
    NextAPI->>CertService: POST /verify { url, serviceToken }
    Note right of CertService: 2. Parse Issuer & Signature
    CertService->>Issuer: Fetch verification metadata / API query
    Issuer-->>CertService: Cryptographic signature & metadata valid
    CertService-->>NextAPI: 200 OK { id: "cert_123", status: "verified", issuer: "Coursera", title: "ML", date }
    
    NextAPI->>DB: Upsert credential in StudentProfile.credentials[] with verificationStatus: "verified"
    DB-->>NextAPI: Profile updated
    NextAPI-->>UI: 200 OK { created: true, certificate: {...} }
    UI->>Student: Renders Blue 'Verified' Badge with verification modal
```

---

## 8. Resume AI Extraction & Review Staging Sequence Flowchart

Shows how PDF resumes are streamed to the Python/FastAPI LLM microservice (`:8000`), staged under an expiring `reviewId`, and merged into the canonical student profile.

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student
    participant UI as Resume Upload Modal
    participant NextAPI as Next.js API (/api/student/resume/*)
    participant LLM as LLM Microservice (:8000)
    participant DB as MongoDB (StudentProfile)

    Student->>UI: Drops Resume PDF (resume.pdf)
    UI->>NextAPI: POST /api/student/resume/extract (multipart/form-data)
    Note over NextAPI: Route maxDuration = 120s
    NextAPI->>NextAPI: Check size <= 10MB & Magic Bytes '%PDF'
    
    NextAPI->>LLM: POST /extract (Binary PDF Stream, 60s timeout)
    Note over LLM: LLM parses text, layout, education, skills, projects
    LLM-->>NextAPI: Extracted Structured JSON
    
    NextAPI->>NextAPI: Create In-Memory Staged Review Record (TTL = 15-30 min)
    NextAPI-->>UI: 200 OK { reviewId: "rev_7f9b8c...", profile: { headline, education[], skills[], projects[] } }
    
    UI->>Student: Displays Side-by-Side Diff & Field Checkboxes
    
    alt Student Approves Extraction
        Student->>UI: Selects fields to import & Clicks 'Apply'
        UI->>NextAPI: POST /api/student/resume/apply { reviewId, selectedFields: {...} }
        NextAPI->>DB: Merge approved fields into StudentProfile
        DB-->>NextAPI: Saved
        NextAPI->>NextAPI: Invalidate staged reviewId
        NextAPI-->>UI: 200 OK { message: "Profile updated successfully", profile }
        UI->>Student: Toast Success & Refresh Profile Sections
    else Student Cancels / Discards
        Student->>UI: Clicks 'Discard'
        UI->>NextAPI: DELETE /api/student/resume/reviews/:reviewId
        NextAPI->>NextAPI: Remove staged review record
        NextAPI-->>UI: 200 OK { discarded: true }
        UI->>Student: Close Modal without Profile Changes
    end
```

---

## 9. Analytics Ingestion & Reporting Dual-Pipeline Flowchart

Demonstrates the strict segregation between high-throughput unauthenticated public visitor event tracking and authenticated owner aggregation reporting.

```mermaid
flowchart TD
    subgraph INGESTION["CHANNEL A: Public Visitor Ingestion (High-Volume, Unauthenticated)"]
        VISITOR["Public Visitor opens onevue.id/card/:user or /p/:user"]
        SDK["OneVueAnalytics SDK Client"]
        POST_EVT["POST /api/analytics/events"]
        RATE{"Rate Limit Check (In-Process Bucket)"}
        FILTER{"Bot & Prefetch Filter"}
        VAL{"Resource Exists & Is Published?"}
        INSERT_EVT["Insert into AnalyticsEvents (ownerId assigned by server)"]
        
        VISITOR --> SDK --> POST_EVT --> RATE
        RATE -- "Exceeded" --> HTTP_429["429 Too Many Requests (Retry-After)"]
        RATE -- "Passed" --> FILTER
        FILTER -- "Bot / Prefetch" --> HTTP_202_DROP["202 Accepted (Filtered)"]
        FILTER -- "Legitimate Visitor" --> VAL
        VAL -- "Unpublished or Missing" --> HTTP_404["404 Not Found"]
        VAL -- "Valid Published Resource" --> INSERT_EVT --> HTTP_202["202 Accepted"]
    end

    subgraph REPORTING["CHANNEL B: Private Owner Reporting (Authenticated with Bearer JWT)"]
        OWNER["Student / Creator opens Analytics Dashboard"]
        GET_REP["GET /api/analytics/overview<br>GET /api/analytics/resources/:id/timeseries<br>GET /api/analytics/resources/:id/audience"]
        VERIFY_AUTH["VerifyAuth: Extract caller userId"]
        OWNERSHIP{"Resource ownerId == caller userId?"}
        AGG["MongoDB Aggregation Pipeline ($match, $group, $sort)"]
        CHARTS["Frontend Renders Totals, Bucketized Timeseries & Device Graphs"]
        EXPORT["GET .../export?format=csv (Direct CSV Download)"]

        OWNER --> GET_REP --> VERIFY_AUTH --> OWNERSHIP
        OWNERSHIP -- "No (Unauthorized)" --> HTTP_403["403 / 404 Access Denied"]
        OWNERSHIP -- "Yes (Authorized)" --> AGG --> CHARTS
        CHARTS -.-> EXPORT
    end
```

---

## 10. Frontend Service Layer & Reducer State Transition Flowchart

Illustrates the exact state lifecycle for form saves and HTTP interactions to guarantee zero false-positive success toasts on network or validation errors.

```mermaid
stateDiagram-v2
    [*] --> Idle

    state "Loading State" as Loading {
        Idle --> LoadStart: Trigger Initial Fetch
        LoadStart --> LoadSuccess: 200 OK received
        LoadStart --> LoadError: Error / 4xx / 5xx
        LoadError --> LoadStart: Retry
    }

    state "Editing State" as Editing {
        LoadSuccess --> UserTyping: User edits draft input
        UserTyping --> UserTyping: Local state mutation
    }

    state "Saving State" as Saving {
        UserTyping --> SaveStart: Clicks 'Save Changes'
        SaveStart --> Sanitize: Strip server fields (userId, _id, verificationStatus)
        Sanitize --> HttpPut: Send PUT /api/student/profile
        
        state HttpPut {
            [*] --> Network
            Network --> Response200: 200 OK
            Network --> ResponseErr: 4xx / 5xx / Network Failure
        }

        Response200 --> SaveSuccess: Dispatch 'save_success'
        ResponseErr --> SaveError: Dispatch 'save_error'
    }

    SaveSuccess --> Editing: Set notice='saved', show Green Toast, update baseline
    SaveError --> Editing: Set saveError=message, show Red Error Toast, retain user input
```

---

## 11. Summary of Companion Files

| File Name | Purpose | Location |
|---|---|---|
| **`BACKEND_ARCHITECTURE_FRONTEND_SPEC.md`** | Comprehensive written API contract, endpoints, payloads, and validation rules | [docs/BACKEND_ARCHITECTURE_FRONTEND_SPEC.md](file:///c:/Users/srivv/Downloads/Telegram%20Desktop/company_project/docs/BACKEND_ARCHITECTURE_FRONTEND_SPEC.md) |
| **`BACKEND_PIPELINE_ARCHITECTURE_FLOWCHARTS.md`** | Visual flowcharts, Mermaid diagrams, state transitions, and sequence diagrams | [docs/BACKEND_PIPELINE_ARCHITECTURE_FLOWCHARTS.md](file:///c:/Users/srivv/Downloads/Telegram%20Desktop/company_project/docs/BACKEND_PIPELINE_ARCHITECTURE_FLOWCHARTS.md) |
| **`visiting-card-studio-audit.md`** | Detailed Canva-style Visiting Card Studio requirements and gap analysis | [docs/visiting-card-studio-audit.md](file:///c:/Users/srivv/Downloads/Telegram%20Desktop/company_project/docs/visiting-card-studio-audit.md) |
| **`docs/analytics/api-reference.md`** | Analytics ingestion and reporting documentation | [docs/analytics/api-reference.md](file:///c:/Users/srivv/Downloads/Telegram%20Desktop/company_project/docs/analytics/api-reference.md) |
