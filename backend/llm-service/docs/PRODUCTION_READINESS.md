# ONEVUE LLM Service — Production Readiness Assessment

This document assesses the operational and release readiness of the ONEVUE LLM Service across technical, security, compliance, operational, and integration dimensions.

### Status Definitions
* **Done — verified by local code/tests:** Fully implemented and validated by offline automated tests or static analysis within this repository.
* **Implemented — operational verification pending:** Implemented in code, but end-to-end verification requires operational deployment, live human execution, or production environment setup.
* **Blocked — external decision or action required:** Dependent on an organizational, legal, compliance, or external application action outside this microservice.
* **Not implemented:** Not implemented in this codebase (e.g. intentionally excluded by project rules).
* **Not verified:** Not yet assessed or validated against operational criteria.

---

## 1. Readiness Matrix

| Category | Assessment Item | Status | Verification Details & Notes |
|---|---|---|---|
| **Testing** | Automated Test Suite | **Done — verified by local code/tests** | 548+ offline tests passing with pytest. Zero network or provider calls in test suite. |
| **Code Quality** | Static Analysis & Formatting | **Done — verified by local code/tests** | 100% clean Ruff check (`ruff check .`) and Ruff formatting (`ruff format --check .`). |
| **Security** | Secret Scanning & PII Scrubber | **Done — verified by local code/tests** | Canary secret detection tests passing; structured error and log sanitizers verified offline. |
| **Security** | Dependency Vulnerability Scanning | **Implemented — operational verification pending** | Core dependencies pinned in requirements.txt. Automated CI pip-audit / Dependabot scanning pending pipeline integration. |
| **Security** | API Authentication & Key Rotation | **Done — verified by local code/tests** | Constant-time `X-API-Key` verification across 10-key rotation window (`SERVICE_API_KEYS`). Fail-closed logic verified. |
| **Security** | Metrics Credential Separation | **Done — verified by local code/tests** | `/metrics` requires distinct `METRICS_TOKEN`. Service API keys explicitly rejected. |
| **Reliability** | PDF Parser Subprocess Isolation | **Done — verified by local code/tests** | `IsolatedPDFParser` executes in child process with unidirectional pipes, 15s timeout, and SIGKILL containment. |
| **Reliability** | Parser Virtual Memory Limits | **Implemented — operational verification pending** | Wall-clock timeouts and crash containment verified. OS-level cgroup/virtual memory limits require container configuration. |
| **Reliability** | Concurrency Protection & Deadlines | **Done — verified by local code/tests** | `ExtractionConcurrencyLimiter` bounds concurrent extractions (`MAX_CONCURRENT_EXTRACTIONS=2`). 60s hard deadline verified. |
| **Reliability** | Circuit Breaker & Fallback | **Done — verified by local code/tests** | 3-failure threshold, 30s cooldown, transient error filtering, and production fallback guard verified by unit tests. |
| **Observability** | Structured Logging & Redaction | **Done — verified by local code/tests** | JSON logging with automated masking of tokens, secrets, prompts, raw text, and disallowed extras verified. |
| **Observability** | Health, Readiness, Version Probes | **Done — verified by local code/tests** | `/health`, `/ready` (without external calls), and `/version` endpoints verified by tests. |
| **Observability** | Protected Prometheus Metrics | **Done — verified by local code/tests** | Low-cardinality metrics registry and exposition format verified by tests. |
| **Architecture** | Multi-Worker State Boundaries | **Done — verified by local code/tests** | Startup detector (`warn_multi_worker_if_detected`) logs clear warnings if worker count > 1. Documented in runbook. |
| **Contract** | OpenAPI Contract Validation | **Done — verified by local code/tests** | Stable `docs/openapi.json` generated from FastAPI schema with offline regression test enforcing synchronization. |
| **Operations** | Mock-Mode Load Benchmark | **Done — verified by local code/tests** | Bounded local loopback test harness (`scripts/load_test.py`) verified with synthetic in-memory fixtures. |
| **Operations** | Manual Live Provider Verification | **Implemented — operational verification pending** | `scripts/live_check.py` implemented with safety flag and 1-call budget. Live validation pending operator execution with credentials. |
| **Operations** | Consented Real-Resume Evaluation | **Implemented — operational verification pending** | `scripts/evaluate_consented.py` implemented with strict repo-isolation checks. Execution pending gathering consented student dataset. |
| **Operations** | Operational Incident & Rollback Runbook | **Implemented — operational verification pending** | Runbook documented in `docs/RUNBOOK.md`. Live incident drill and rollback dry-run pending staging deployment. |
| **Legal** | PyMuPDF AGPL-3.0 vs. PyPDFium2 Decision | **Blocked — external decision or action required** | Both backends implemented and switchable via `PDF_BACKEND`. Formal organizational legal sign-off required before production release. |
| **Compliance** | Upstream Provider Enterprise DPAs | **Blocked — external decision or action required** | Requires institutional agreement with Groq and NVIDIA confirming Zero Data Retention (ZDR) and no model training on customer data. |
| **Compliance** | Student Privacy Notice & Retention Policy | **Blocked — external decision or action required** | Privacy architecture documented in `docs/PRIVACY.md`. Institutional legal and compliance approval of privacy notice required. |
| **Integration** | Main Application Auth & Persistence | **Blocked — external decision or action required** | Main ONEVUE backend must implement user authentication, session security, and profile database persistence. |
| **Integration** | Review-Before-Save UI Workflow | **Blocked — external decision or action required** | Main ONEVUE frontend must implement human-in-the-loop review screens honoring `fieldMeta` and `warnings`. |
| **Deployment** | Staging Environment Verification | **Not verified** | Cloud hosting, container orchestration, and staging environment verification not yet established. |
| **Infrastructure** | Global Edge Rate Limiting | **Blocked — external decision or action required** | Process-local rate guards are implemented; external reverse proxy or CDN edge rate limiting required at infrastructure layer. |

---

## 2. Critical Release Blockers Prior to Production Go-Live

The service **cannot be declared production-ready** until the following external and operational gates are resolved:

1. **Gate 1 — Legal Review of PyMuPDF Licensing:**
   * *Status:* Blocked.
   * *Action Required:* Organization legal counsel must determine whether deploying PyMuPDF under AGPL-3.0 in this network topology is acceptable, or whether the production configuration must set `PDF_BACKEND=pypdfium2`.
2. **Gate 2 — Enterprise Provider Terms & Zero-Data-Retention Agreements:**
   * *Status:* Blocked.
   * *Action Required:* Secure signed Data Processing Agreements with Groq and NVIDIA confirming that student resumes sent to `api.groq.com` or `integrate.api.nvidia.com` are not retained or utilized for model training.
3. **Gate 3 — Main ONEVUE Application Integration:**
   * *Status:* Blocked.
   * *Action Required:* Complete the integrating backend client according to `docs/INTEGRATION.md`, verify `X-API-Key` server-side security, and implement the Review-Before-Save user interface in the student portal.
4. **Gate 4 — Staging Deployment and Live Smoke Testing:**
   * *Status:* Not verified.
   * *Action Required:* Deploy the containerized service to an isolated staging environment and execute `scripts/live_check.py` to confirm egress network paths and credentials.

---

## 3. Production Readiness Conclusion

The ONEVUE LLM Service codebase is **feature-complete and thoroughly verified by local unit, integration, and security regression tests**.

However, in accordance with strict engineering standards:
> **The service is NOT YET production-ready.**
> Technical code completion is only one component of release readiness. Production deployment remains blocked on external licensing decisions, provider compliance agreements, main application integration, and staging environment verification.
