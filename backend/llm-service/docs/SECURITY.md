# ONEVUE LLM Service — Security Policy

This document details the security posture, vulnerability reporting procedures, implemented technical controls, and operational guidelines for the ONEVUE LLM Service.

---

## 1. Reporting Security Vulnerabilities

If you discover a security vulnerability in the ONEVUE LLM Service:
* **Do NOT file a public issue.**
* Contact the engineering and security leads via the designated internal security reporting channel.
* Include a minimal proof-of-concept using **synthetic documents only**. Never include real resumes, real personal information, or real credentials in vulnerability reports.

---

## 2. Core Security Boundaries and Guarantees

The LLM service enforces strict boundaries designed for defensive backend microservices:

1. **Zero Browser Access:** The service has no CORS origins configured and is not accessible from the public internet or client browsers. All access is mediated through the main ONEVUE backend application.
2. **Fail-Closed Authentication:** Protected endpoints (`/v1/extract`) require an `X-API-Key` header verified with constant-time equality checks (`secrets.compare_digest`). If no keys are configured in settings, all requests fail closed with HTTP 401.
3. **Metrics Separation:** The operational Prometheus `/metrics` endpoint is protected by a separate `METRICS_TOKEN`. Service API keys are explicitly rejected on the metrics endpoint.
4. **Isolated PDF Parser:** PDF parsing (using PyMuPDF) runs in a separate child process using Python's `spawn` multiprocessing context. C-level segmentation faults, parser crashes, and runaway loops cannot terminate or corrupt the main application process.
5. **No Data Persistence:** The microservice is completely stateless. It operates without a database, cache layer, or local file storage. PDF bytes reside strictly in memory and are discarded upon request completion.
6. **Sanitized Telemetry & Logs:** All log messages, structured extras, and error payloads pass through sanitization filters that mask credential patterns (e.g., `gsk_`, `nvapi-`, `sk-`, Bearer tokens) and strip resume text, prompts, and personal data.

---

## 3. Implemented Controls vs. Integrating Application Responsibilities

| Control Domain | Implemented in LLM Service | Integrating Application Responsibility |
|---|---|---|
| **Service Authentication** | Constant-time `X-API-Key` verification across rotation window | Secure storage of service key in server-side secrets manager; never expose key to frontend |
| **User Authentication** | N/A (Service is machine-to-machine) | Authenticate student sessions, verify JWTs, enforce access controls |
| **Rate Limiting** | Process-local sliding window (`40 req/min`) | User-level and IP-level rate limiting at API gateway / reverse proxy |
| **Concurrency Control** | Process-local semaphore (`MAX_CONCURRENT_EXTRACTIONS=2`) | Queue management and ingress load balancing across instances |
| **Input Validation** | Strict PDF magic-number check, size limits (10 MB), page ceiling (10 pages) | Pre-validation of student file type and virus scanning before forwarding |
| **Data Retention** | Zero disk persistence; in-memory processing only | Document retention policies, student consent tracking, secure database storage |
| **Error Reporting** | Privacy scrubber stripping headers, cookies, request bodies, and locals | Sentry project configuration and access management |

---

## 4. Key Rotation Protocol

To rotate service API keys without service downtime:
1. Populate `SERVICE_API_KEYS` with comma-separated keys: `"new_secret,old_secret"`.
2. Deploy the LLM service.
3. Update the integrating application to transmit `new_secret`.
4. Deploy the integrating application.
5. Remove `old_secret` from `SERVICE_API_KEYS`: `"new_secret"`.
6. Redeploy the LLM service.

---

## 5. Dependency and Licensing Posture

* **PyMuPDF (fitz):** Licensed under GNU AGPL-3.0. In network server deployments, AGPL-3.0 may trigger copyleft source-distribution requirements if modified or bundled inappropriately. An alternative backend using `pypdfium2` (Apache-2.0 / BSD-3-Clause) is implemented and switchable via `PDF_BACKEND=pypdfium2`. A final organizational legal decision is required prior to commercial distribution.
* **FastAPI / Pydantic / Starlette:** Licensed under MIT / BSD permissive licenses.
* **Upstream Providers:** Interactions with Groq and NVIDIA NIM rely on standard HTTPS REST calls without proprietary SDK lock-in.
