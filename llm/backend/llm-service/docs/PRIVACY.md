# ONEVUE LLM Service — Privacy & Data Protection Guide

This document details how the ONEVUE LLM Service processes candidate data, our data minimization architecture, and the privacy requirements for integrating systems.

---

## 1. Information Processed by the Service

The ONEVUE LLM Service processes student and job candidate resume documents submitted via `POST /v1/extract`.

Resumes typically contain sensitive **Personally Identifiable Information (PII)** and personal data, including:
* Full name and contact information (personal email address, phone number, physical location/city).
* Academic history (educational institutions, degree programs, graduation dates, grade point averages).
* Employment and professional history (employer names, job titles, employment dates, project descriptions).
* Technical and professional skills.
* Portfolio project descriptions and external social/code repository hyperlinks (e.g., GitHub, LinkedIn).

---

## 2. In-Memory Processing & Zero Persistence

The ONEVUE LLM Service is architected around strict **data minimization** and **zero data persistence**:

1. **No Database:** The microservice contains no database engine, no document store, and no relational schema.
2. **Zero Disk Storage:** Uploaded PDF documents are processed entirely in memory as chunked byte streams (`bytes`). They are never written to the local filesystem or temporary disk directories (e.g., `/tmp`).
3. **Subprocess Pipe IPC:** The isolated PDF parser communicates with the child worker process via unidirectional memory pipes created by `os.pipe()`. No temporary files or sockets are created on disk.
4. **Immediate Lifecycle Disposal:** PDF bytes, extracted text buffers, and intermediate LLM drafts are held in process memory only for the duration of the active HTTP request (typically 2–5 seconds). Once the response envelope is serialized and returned to the client, all in-memory buffers are unreferenced and reclaimed by Python garbage collection.

---

## 3. Operational Telemetry: What is Logged vs. What is Never Logged

To maintain operational visibility without violating candidate privacy, our structured logging engine strictly enforces a clear separation:

### Allowed Operational Metadata
* Standard request correlation ID (`X-Request-ID` or generated UUID).
* HTTP method, response status code, and normalized route path (e.g., `POST /v1/extract`).
* Wall-clock execution duration in milliseconds.
* Selected upstream provider name (e.g., `llama-3.3-70b-versatile` or `mock`).
* High-level, low-cardinality error categories (e.g., `INVALID_FILE`, `PROVIDER_RATE_LIMITED`).
* Low-cardinality Prometheus metrics.

### Strictly Forbidden in Logs (Never Logged)
* Candidate names, email addresses, phone numbers, or addresses.
* Raw uploaded PDF bytes or document filenames.
* Raw extracted resume text or cleaned text blocks.
* System prompt templates or user prompts sent to LLMs.
* Raw model generation responses or unparsed drafts.
* Server API keys, provider credentials, or authorization tokens.

The logging filter (`sanitize_text_for_logging()`) and extra-field filter (`_DISALLOWED_EXTRA_KEYS`) automatically drop or mask any accidental inclusions.

---

## 4. Transmission to Upstream LLM Providers

When running in production mode (`MOCK_MODE=false`), the service transmits cleaned and truncated resume text over encrypted TLS connections to external LLM providers:
* **Primary Provider:** Groq Inc. (API endpoint: `https://api.groq.com/openai/v1`).
* **Fallback Provider (if enabled):** NVIDIA Corporation (API endpoint: `https://integrate.api.nvidia.com/v1`).

### Provider Terms & Data Retention Verification

> ⚠️ **IMPORTANT COMPLIANCE NOTICE:**
> The ONEVUE LLM Service code cannot enforce how third-party provider APIs store data once transmitted over their network boundary.
>
> * **Standard API Terms vs. Enterprise DPA:** By default, public API tiers may retain request logs for security monitoring or abuse detection.
> * **Zero Data Retention (ZDR):** The deploying organization **must independently verify** and execute an Enterprise Data Processing Agreement (DPA) with Groq and NVIDIA ensuring:
>   1. Zero-day data retention (transient processing only).
>   2. Explicit commitment that customer prompts and resume text are **never used to train foundational or fine-tuned models**.
>   3. Compliance with applicable regional privacy frameworks (e.g., GDPR, FERPA, CCPA).

---

## 5. Optional Error Reporting (Sentry Scrubber)

External exception monitoring (e.g., Sentry) is **optional and disabled by default** (`ERROR_REPORTING_ENABLED=false`).

If enabled by operators, all outbound error events pass through the mandatory privacy scrubber (`scrub_error_event()`):
1. **Headers Scrubbed:** `X-API-Key`, `Authorization`, and `Cookie` headers are replaced with `[REDACTED_HEADER]`.
2. **Request Body Dropped:** The entire request body is replaced with `[REDACTED_REQUEST_BODY]`.
3. **Stack Frame Locals Redacted:** Stack frame local variables (`vars`) are stripped to `[REDACTED_FRAME_VARS]` to ensure in-memory resume text does not leak into stack traces.
4. **Breadcrumbs Sanitized:** Breadcrumbs containing forbidden keys or credential patterns are masked.

---

## 6. Real-Resume Evaluation Protocol

When conducting offline model evaluation with real resumes, operators must adhere to the privacy protocol enforced by `scripts/evaluate_consented.py`:

1. **Informed Consent:** Resumes must be collected strictly with informed, documented consent from candidates for evaluation purposes.
2. **Anonymized Case IDs:** Ground truth label files must use anonymous identifiers (e.g., `case_001`, `case_002`) rather than candidate names or identifiable data.
3. **Repository Tree Isolation:** Benchmark dataset directories and label files **must reside strictly outside the git repository tree**. The script actively rejects paths located inside or symlinked into the repository.
4. **Aggregate Reporting Only:** The evaluation tool computes aggregate precision, recall, and F1 metrics. It never prints candidate text, filenames, or label values.
5. **Secure Deletion:** Operators must securely shred or delete evaluation documents following the conclusion of evaluation benchmarks.

---

## 7. Responsibilities of the Integrating ONEVUE Application

The main ONEVUE application backend persists student data and provides the student user interface. It is solely responsible for:
1. **Privacy Notice & Consent:** Displaying appropriate institutional privacy notices and securing user consent prior to submitting resumes for automated extraction.
2. **Access Control:** Enforcing robust user authentication and authorization so students only see their own extracted profile drafts.
3. **Review-Before-Save Enforcement:** Ensuring students review, verify, and confirm extracted profile fields before saving.
4. **Persistence Security:** Encrypting saved student profiles at rest in the main application database.
5. **Right-to-Erasure & Data Retention:** Implementing candidate account deletion workflows and adhering to institutional student record retention policies.
