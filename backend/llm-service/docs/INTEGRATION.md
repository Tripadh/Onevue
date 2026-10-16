# ONEVUE LLM Service — Integration Guide

This guide is written for backend engineers integrating the `onevue-llm-service` microservice into the main ONEVUE application backend.

---

## A. Architecture and Trust Boundaries

The ONEVUE LLM Service is an isolated server-side microservice dedicated exclusively to resume text extraction, rule parsing, LLM-based profile synthesis, and grounding verification.

```
┌─────────────────┐       Browser Session / JWT       ┌────────────────────────┐
│  Client Browser │ ─────────────────────────────────> │  Main ONEVUE Backend   │
│  (Student User) │ <───────────────────────────────── │  (Auth, DB, UI State)  │
└─────────────────┘      Reviewable Draft Profile      └───────────┬────────────┘
                                                                   │
                                                Server-to-Server   │ Multipart Upload
                                                X-API-Key Auth     │ X-Request-ID
                                                                   ▼
                                                       ┌────────────────────────┐
                                                       │   ONEVUE LLM Service   │
                                                       │  (Stateless, No DB)    │
                                                       └────────────────────────┘
```

### Trust Boundary Rules

1. **Strict Machine-to-Machine Perimeter:** The LLM service is an internal backend component. Client browsers and mobile applications must **never** call the LLM service directly and must **never** receive the service API key.
2. **User Authentication & Authorization:** The integrating main ONEVUE application backend is solely responsible for authenticating users (e.g., student JWT/session cookies), validating role-based authorization, and managing candidate profiles.
3. **Stateless Processing:** The LLM service does not own a database, does not persist uploaded files, and does not retain student profiles. All profile storage and data persistence reside exclusively in the main ONEVUE application.

---

## B. Authentication

### Server-to-Server Authentication Header

Requests to protected endpoints (`POST /v1/extract`) require the `X-API-Key` HTTP header:

```http
X-API-Key: your-server-side-service-api-key
```

### Key Precedence and Zero-Downtime Key Rotation

The service supports zero-downtime credential rotation using constant-time comparison (`secrets.compare_digest`) across an active rotation window of up to 10 keys:

1. **`SERVICE_API_KEYS` (Primary Rotation Setting):** A comma-separated list of active keys (e.g., `SERVICE_API_KEYS="new-key-2026,old-key-2025"`). Any incoming request matching any key in this window is accepted.
2. **`LLM_SERVICE_API_KEY` (Single-Key Fallback):** Used if `SERVICE_API_KEYS` is unset.
3. **`SERVICE_API_KEY` (Legacy Alias):** Used if both preceding variables are unset.
4. **Fail-Closed Behavior:** If no service keys are configured, the service fails closed and returns `401 Unauthorized` for all extraction requests.

> **Rotation Procedure:**
> 1. Deploy the LLM service with `SERVICE_API_KEYS="<new_key>,<old_key>"`.
> 2. Update the integrating backend configuration to send `<new_key>`.
> 3. Verify successful requests.
> 4. Deploy the LLM service with `SERVICE_API_KEYS="<new_key>"`, retiring `<old_key>`.

### Authentication Failure Contract

When authentication fails (missing header, invalid key, or unconfigured service), the service returns HTTP `401 Unauthorized` with a structured error payload:

```json
{
  "code": "UNAUTHORIZED",
  "message": "Missing or invalid API key."
}
```

> **Security Note:** Service API keys cannot be used to access the `/metrics` endpoint. The metrics endpoint is protected by a distinct `METRICS_TOKEN` credential.

---

## C. Request and Response Examples

All examples use synthetic candidate information.

### 1. Successful Extraction Request

```bash
curl -X POST "http://localhost:8000/v1/extract" \
  -H "X-API-Key: test-service-key" \
  -H "X-Request-ID: c56a4180-65aa-42ec-a945-5fd21dec0538" \
  -F "file=@sample_resume.pdf;type=application/pdf"
```

### 2. Representative Successful Response (`status: "ok"`)

```json
{
  "status": "ok",
  "data": {
    "profile": {
      "name": "Jordan Doe",
      "headline": "Full-Stack Software Engineer",
      "email": "jordan.doe.synthetic@example.com",
      "phone": "+1-555-019-2831",
      "location": "San Francisco, CA",
      "summary": "Full-stack engineer with 4+ years of experience in distributed microservices."
    },
    "education": [
      {
        "institution": "State University of Technology",
        "degree": "B.S. Computer Science",
        "fieldOfStudy": "Computer Science",
        "startDate": "2016-08",
        "endDate": "2020-05",
        "grade": "3.8 GPA"
      }
    ],
    "experience": [
      {
        "company": "Acme Innovations Inc.",
        "title": "Software Engineer",
        "location": "San Francisco, CA",
        "startDate": "2020-06",
        "endDate": null,
        "isCurrent": true,
        "bullets": [
          "Engineered distributed REST APIs handling high throughput.",
          "Implemented asynchronous background pipeline workers."
        ]
      }
    ],
    "skills": [
      {"name": "Python"},
      {"name": "FastAPI"},
      {"name": "TypeScript"},
      {"name": "PostgreSQL"},
      {"name": "Docker"}
    ],
    "projects": [
      {
        "name": "Cloud Observability Dashboard",
        "description": "Real-time metrics visualization platform for distributed services.",
        "technologies": ["Python", "React", "Prometheus"],
        "links": ["https://github.com/example-synthetic/cloud-dashboard"]
      }
    ],
    "achievements": [
      {
        "title": "Hackathon First Place Winner",
        "description": "Awarded first place for cloud automation tooling project."
      }
    ],
    "socialLinks": [
      {
        "platform": "github",
        "url": "https://github.com/example-synthetic"
      },
      {
        "platform": "linkedin",
        "url": "https://linkedin.com/in/example-synthetic"
      }
    ]
  },
  "fieldMeta": {
    "profile.name": {
      "confidence": "high",
      "grounded": true,
      "source": "llm",
      "alternatives": [],
      "grounding_status": "grounded",
      "evidence": ["Jordan Doe"]
    },
    "profile.email": {
      "confidence": "high",
      "grounded": true,
      "source": "rules",
      "alternatives": [],
      "grounding_status": "grounded",
      "evidence": ["jordan.doe.synthetic@example.com"]
    }
  },
  "warnings": [],
  "meta": {
    "schemaVersion": "1.0.0",
    "provider": "llama-3.3-70b-versatile",
    "fallbackUsed": false,
    "latencyMs": 1420,
    "mock": false,
    "primaryProvider": "groq",
    "fallbackProvider": null,
    "attemptsCount": 1,
    "quotaBlocked": false
  },
  "error": null
}
```

### 3. Partial Extraction Response (`status: "partial"`)

When the extracted draft fails strict schema validation (e.g. inverted dates or contradictory current employment) and the service's single bounded repair attempt cannot resolve it, the service deterministically sanitizes the data into a valid partial structure and returns HTTP 200 with `status: "partial"`:

```json
{
  "status": "partial",
  "data": {
    "profile": {
      "name": "Morgan Smith",
      "headline": "Junior Developer",
      "email": "morgan.smith.synthetic@example.com",
      "phone": null,
      "location": "Austin, TX",
      "summary": "Recent graduate passionate about backend development."
    },
    "education": [
      {
        "institution": "Technical Institute",
        "degree": "B.S. Information Technology",
        "fieldOfStudy": "IT",
        "startDate": "2020",
        "endDate": "2024",
        "grade": null
      }
    ],
    "experience": [
      {
        "company": "Beta Solutions",
        "title": "Software Intern",
        "location": "Austin, TX",
        "startDate": "2023-06",
        "endDate": null,
        "isCurrent": true,
        "bullets": ["Assisted in maintaining internal tooling."]
      }
    ],
    "skills": [
      {"name": "Python"},
      {"name": "SQL"}
    ],
    "projects": [],
    "achievements": [],
    "socialLinks": []
  },
  "fieldMeta": {
    "profile.name": {
      "confidence": "medium",
      "grounded": true,
      "source": "llm",
      "alternatives": [],
      "grounding_status": "grounded",
      "evidence": ["Morgan Smith"]
    }
  },
  "warnings": [
    {
      "path": "experience[0].endDate",
      "code": "CONFLICT",
      "message": "Contradictory current role endDate omitted."
    },
    {
      "path": "education[0].startDate",
      "code": "AMBIGUOUS_DATE",
      "message": "Ambiguous seasonal date 'Fall 2020' normalized to year-only."
    }
  ],
  "meta": {
    "schemaVersion": "1.0.0",
    "provider": "llama-3.3-70b-versatile",
    "fallbackUsed": false,
    "latencyMs": 2840,
    "mock": false,
    "primaryProvider": "groq",
    "fallbackProvider": null,
    "attemptsCount": 2,
    "quotaBlocked": false
  },
  "error": {
    "code": "INVALID_OUTPUT",
    "message": "Repaired draft failed schema validation constraints."
  }
}
```

### 4. Validation and Client Error Responses

All non-200 responses return a consistent `StructuredError` JSON envelope.

#### Invalid File Format (HTTP 400)
```json
{
  "code": "INVALID_FILE",
  "message": "Invalid file upload. Only .pdf files are supported."
}
```

#### File Size Exceeded (HTTP 413)
```json
{
  "code": "FILE_TOO_LARGE",
  "message": "PDF file size (12582912 bytes) exceeds maximum allowed limit of 10485760 bytes."
}
```

#### Page Limit Exceeded (HTTP 422)
```json
{
  "code": "TOO_MANY_PAGES",
  "message": "PDF document contains 14 pages, exceeding maximum limit of 10 pages."
}
```

#### Scanned PDF Without Text Layer (HTTP 422)
```json
{
  "code": "SCANNED_PDF",
  "message": "PDF document contains insufficient selectable text (scanned image). OCR is not supported."
}
```

#### Encrypted PDF (HTTP 422)
```json
{
  "code": "ENCRYPTED_PDF",
  "message": "PDF document is password-protected or encrypted."
}
```

### 5. Upstream Provider Failure and Timeout Responses

#### Upstream Rate Limiting (HTTP 429)
```json
{
  "code": "PROVIDER_RATE_LIMITED",
  "message": "Upstream extraction provider rate limit exceeded. Please retry later."
}
```

#### Concurrency Queue Saturation (HTTP 503)
Header: `Retry-After: 5`
```json
{
  "code": "PROVIDER_UNAVAILABLE",
  "message": "Service is at capacity and could not acquire concurrency slot within 5.0s. Please retry shortly."
}
```

#### Circuit Breaker Open (HTTP 503)
```json
{
  "code": "PROVIDER_UNAVAILABLE",
  "message": "Primary provider 'groq' circuit breaker is OPEN and no fallback provider is available."
}
```

#### Request Deadline Exceeded (HTTP 504)
```json
{
  "code": "PROVIDER_UNAVAILABLE",
  "message": "Extraction request exceeded overall deadline of 60.0s."
}
```

---

## D. Timeout and Retry Policy

### Integrating Backend HTTP Timeout Configuration

* The LLM service enforces an internal overall deadline of `EXTRACTION_DEADLINE_SECONDS = 60.0` seconds.
* The integrating backend **must** set its HTTP client timeout slightly higher than the service deadline, recommended at **65 to 70 seconds**.
* Configuring a client timeout lower than 60 seconds risks severing client connections while the service is in the final stages of bounded repair or grounding verification.
* Configuring a client timeout higher than 70 seconds allows the service to cleanly return its structured `504` error instead of causing abrupt socket resets.

### Retry Rules

| Response Status | Error Code | Safe to Automatically Retry? | Guidance |
|---|---|---|---|
| **400 Bad Request** | `INVALID_FILE` | **NO** | Client error; malformed file or corrupt structure. |
| **401 Unauthorized** | `UNAUTHORIZED` | **NO** | Configuration error; check service API keys. |
| **413 Payload Too Large** | `FILE_TOO_LARGE` | **NO** | File exceeds 10 MB ceiling. |
| **422 Unprocessable** | `TOO_MANY_PAGES`, `ENCRYPTED_PDF`, `SCANNED_PDF` | **NO** | Document property violation; user must upload eligible PDF. |
| **429 Too Many Requests** | `PROVIDER_RATE_LIMITED` | **YES** | Upstream or local rate limit. Wait with exponential backoff (e.g. 5–15s). |
| **502 Bad Gateway** | `PROVIDER_AUTH` | **NO** | Upstream provider key issue; requires operator resolution. |
| **502 Bad Gateway** | `INVALID_OUTPUT` | **NO** | Service already attempted bounded repair; retrying will likely fail identically. |
| **503 Unavailable** | `PROVIDER_UNAVAILABLE` | **YES** (conditional) | If `Retry-After` header is present, wait indicated seconds (e.g. 5s) and retry at most once. |
| **504 Gateway Timeout** | `PROVIDER_UNAVAILABLE` | **NO** (automatic) | Request exceeded 60s; prompt user to retry manually or inspect document complexity. |

### Idempotency Caveat

> **CRITICAL:** The service **does not support an idempotency key header** (`Idempotency-Key`) and does not cache extraction results across requests. Every call to `POST /v1/extract` initiates a full PDF parsing pipeline, upstream LLM inferences, and potential repair calls. The integrating backend must avoid blind retry loops to prevent unnecessary provider costs and concurrency exhaustion.

---

## E. Partial Results, Confidence, Provenance, and Warnings

The integrating application must treat the LLM service as an assistive drafting tool, not an infallible authority.

### 1. Extraction Status
* `status: "ok"`: The document extracted cleanly and satisfied all schema constraints.
* `status: "partial"`: One or more fields failed validation and could not be repaired by the LLM. Dropped or sanitized fields are documented in `warnings`. The integrating application should present the draft with visual callouts indicating that certain fields were omitted or require user input.

### 2. Confidence Scores
Each field in `fieldMeta` receives a confidence level:
* `high`: Grounded directly by deterministic rules (e.g., regex email/URL match) or grounded by LLM with exact substring match in source document.
* `medium`: Grounded by LLM with fuzzy/normalized token matching or supported by surrounding context.
* `low`: LLM-generated field lacking direct lexical grounding in source text. The UI should prompt the student to verify low-confidence fields.

### 3. Provenance and Grounding
* `source: "rules"`: Field extracted deterministically by regex or PDF link annotations (highest fidelity for contact information).
* `source: "llm"`: Field synthesized by the upstream LLM provider.
* `source: "llm+check"`: Field synthesized by LLM and corroborated by second-opinion validation.
* `grounding_status: "unsupported"`: The LLM generated a value that could not be matched against any evidence in the uploaded PDF. The UI should highlight unsupported fields for student confirmation.

### 4. Warnings
Inspect the `warnings` array on every response:
* `AMBIGUOUS_DATE`: Date formats like "Summer 2021" or "Expected 2026" that were safely normalized or nulled.
* `CONFLICT`: Inconsistencies like `isCurrent: true` combined with an `endDate` that were sanitized.
* `INPUT_TRUNCATED`: Document exceeded 24,000 characters and was truncated prior to LLM submission.
* `MOCK_DATA`: Service is operating in mock mode for testing.

---

## F. Review-Before-Save Workflow

The integrating ONEVUE application **must** implement the following six-step human-in-the-loop workflow:

```
[1] User Uploads PDF ──> [2] Main Backend Calls LLM Service ──> [3] Main Backend Validates Response
                                                                             │
[6] Save to Database <── [5] User Confirms / Edits <── [4] Present Reviewable Draft in UI
```

1. **Authentication & Authorization:** The student logs into the main ONEVUE application. The main backend verifies user identity and permissions.
2. **Backend Submission:** The main backend forwards the uploaded PDF to `POST /v1/extract` using its server-side `X-API-Key`.
3. **Response Validation:** The main backend parses the response and checks `status`, `fieldMeta`, and `warnings`.
4. **Draft Presentation:** The main frontend presents a "Review Extracted Profile" screen. Extracted values pre-populate form fields, with visual flags on `low` confidence or `unsupported` fields.
5. **Student Confirmation:** The student reviews, edits, supplements, or corrects the extracted information.
6. **Persistence:** Only when the student clicks "Save Profile" does the main backend write the confirmed profile to the ONEVUE database.

---

## G. TypeScript Integration Example

Below is a production-grade, type-safe server-side integration module for Node.js (Node 18+ native `fetch` or `node-fetch`).

```typescript
/**
 * ONEVUE LLM Service Client
 * Server-side integration module for interacting with the ONEVUE LLM Service.
 */

import { randomUUID } from "node:crypto";

export interface Profile {
  name: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
}

export interface Education {
  institution: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  grade: string | null;
}

export interface Experience {
  company: string | null;
  title: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  bullets: string[];
}

export interface Skill {
  name: string;
}

export interface Project {
  name: string | null;
  description: string | null;
  technologies: string[];
  links: string[];
}

export interface Achievement {
  title: string | null;
  description: string | null;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface ResumeData {
  profile: Profile;
  education: Education[];
  experience: Experience[];
  skills: Skill[];
  projects: Project[];
  achievements: Achievement[];
  socialLinks: SocialLink[];
}

export interface FieldMeta {
  confidence: "high" | "medium" | "low";
  grounded: boolean;
  source: "rules" | "llm" | "llm+check";
  alternatives: string[];
  grounding_status?: "grounded" | "partially_grounded" | "unsupported" | "not_checked" | null;
  evidence: unknown[];
}

export interface ExtractionWarning {
  path: string;
  code: string;
  message: string;
}

export interface ExtractionMeta {
  schemaVersion: string;
  provider: string;
  fallbackUsed: boolean;
  latencyMs: number;
  mock: boolean;
  primaryProvider: string | null;
  fallbackProvider: string | null;
  attemptsCount: number;
  quotaBlocked: boolean;
}

export interface StructuredError {
  code: string;
  message: string;
}

export interface ExtractionResponse {
  status: "ok" | "partial";
  data: ResumeData;
  fieldMeta: Record<string, FieldMeta>;
  warnings: ExtractionWarning[];
  meta: ExtractionMeta;
  error?: StructuredError | null;
}

export class LLMServiceClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(`LLMService Error [${code}] (HTTP ${statusCode}): ${message}`);
    this.name = "LLMServiceClientError";
  }
}

export class LLMServiceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options?: { baseUrl?: string; apiKey?: string; timeoutMs?: number }) {
    const rawUrl = options?.baseUrl ?? process.env.LLM_SERVICE_URL;
    const rawKey = options?.apiKey ?? process.env.LLM_SERVICE_API_KEY;

    if (!rawUrl || !rawUrl.trim()) {
      throw new Error("LLMServiceClient configuration error: Missing LLM_SERVICE_URL.");
    }
    if (!rawKey || !rawKey.trim()) {
      throw new Error("LLMServiceClient configuration error: Missing LLM_SERVICE_API_KEY.");
    }

    this.baseUrl = rawUrl.trim().replace(/\/+$/, "");
    this.apiKey = rawKey.trim();
    // Default client timeout 65s (service deadline is 60s)
    this.timeoutMs = options?.timeoutMs ?? 65_000;
  }

  /**
   * Submit a resume PDF buffer to the LLM service for structured profile extraction.
   *
   * @param pdfBuffer In-memory PDF file buffer.
   * @param filename Document filename (must end in .pdf).
   * @param correlationId Optional request correlation ID for end-to-end tracing.
   * @returns Structured ExtractionResponse envelope.
   */
  async extractResume(
    pdfBuffer: Buffer | Uint8Array,
    filename: string = "resume.pdf",
    correlationId?: string
  ): Promise<ExtractionResponse> {
    if (!filename.toLowerCase().endsWith(".pdf")) {
      throw new LLMServiceClientError(400, "INVALID_FILE", "Uploaded file must have .pdf extension.");
    }
    if (pdfBuffer.byteLength === 0) {
      throw new LLMServiceClientError(400, "INVALID_FILE", "Uploaded PDF buffer cannot be empty.");
    }

    const requestId = correlationId ?? randomUUID();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    const formData = new FormData();
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    formData.append("file", blob, filename);

    try {
      const response = await fetch(`${this.baseUrl}/v1/extract`, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "X-Request-ID": requestId,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorCode = "UNKNOWN_ERROR";
        let errorMessage = "Extraction request failed.";

        try {
          const errorBody = (await response.json()) as StructuredError;
          if (errorBody && errorBody.code) {
            errorCode = errorBody.code;
            errorMessage = errorBody.message;
          }
        } catch {
          errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
        }

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

        throw new LLMServiceClientError(response.status, errorCode, errorMessage, retryAfterSeconds);
      }

      const result = (await response.json()) as ExtractionResponse;
      return result;
    } catch (err: unknown) {
      if (err instanceof LLMServiceClientError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new LLMServiceClientError(
          504,
          "CLIENT_TIMEOUT",
          `Client HTTP request timed out after ${this.timeoutMs / 1000}s.`
        );
      }
      throw new LLMServiceClientError(
        500,
        "NETWORK_ERROR",
        err instanceof Error ? err.message : "Failed to communicate with LLM Service."
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Check LLM Service readiness without sending live provider calls.
   */
  async checkReadiness(): Promise<{ ready: boolean; checks: Record<string, string> }> {
    const response = await fetch(`${this.baseUrl}/ready`, {
      method: "GET",
      headers: { "X-Request-ID": randomUUID() },
    });
    const body = (await response.json()) as { ready: boolean; checks: Record<string, string> };
    return body;
  }
}
```
