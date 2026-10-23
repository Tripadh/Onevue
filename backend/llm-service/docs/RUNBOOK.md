# ONEVUE LLM Service — Operational Runbook

This runbook provides routine operational procedures, diagnostics, and recovery instructions for operators running and maintaining the `onevue-llm-service`.

---

## 1. Prerequisites and Local Environment Setup

* **Python:** 3.12+ (isolated virtual environment required)
* **Working Directory:** `backend/llm-service/`

### Initial Setup

```bash
cd backend/llm-service

# Create virtual environment
python3.12 -m venv .venv

# Activate environment
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 2. Safe Startup Instructions

### Development & Offline Testing (Mock Mode)

Mock mode runs the entire FastAPI application locally with **zero external network or provider calls**. It uses deterministic in-memory fixtures.

```bash
# Export environment variables for safe mock operation
export MOCK_MODE=true
export LLM_SERVICE_API_KEY="local-dev-service-key"
export LOG_LEVEL="info"

# Start service on loopback address
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Development with Live Upstream Provider (Groq)

> ⚠️ **Notice:** Live mode initiates billable API calls to Groq.

```bash
export MOCK_MODE=false
export GROQ_API_KEY="your-groq-api-key"
export LLM_SERVICE_API_KEY="local-dev-service-key"
export LOG_LEVEL="info"

./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

---

## 3. How to Run Automated Tests and Lint Checks

All automated tests in `tests/` operate **strictly offline** with synthetic fixtures and mocked providers. They never make network or provider calls.

```bash
# Run full offline test suite
./.venv/bin/pytest

# Run static analysis and style checks
./.venv/bin/ruff check .

# Check formatting compliance
./.venv/bin/ruff format --check .

# Auto-format codebase
./.venv/bin/ruff format .
```

---

## 4. Health, Readiness, and Version Probes

The service exposes three unauthenticated endpoints for orchestration health monitoring.

### A. Liveness Check (`/health`)
Verifies process responsiveness. Does not evaluate upstream connectivity or configuration.

```bash
curl -s http://127.0.0.1:8000/health | jq .
```
Expected output:
```json
{
  "status": "ok",
  "service": "onevue-llm-service",
  "version": "1.0.0"
}
```

### B. Readiness Check (`/ready`)
Verifies local configuration and provider initialization. Does not perform external network calls.

```bash
curl -s -w "\nHTTP Status: %{http_code}\n" http://127.0.0.1:8000/ready | jq .
```

* **Ready (HTTP 200):**
  ```json
  {
    "status": "ready",
    "ready": true,
    "service": "onevue-llm-service",
    "checks": {
      "configuration": "ok",
      "provider": "ok",
      "mock_mode": "false"
    }
  }
  ```
* **Not Ready (HTTP 503):** Returned if service API keys are missing or provider credentials are unset while `MOCK_MODE=false`.

### C. Version Metadata (`/version`)
Returns build metadata, environment, and optional commit SHA.

```bash
curl -s http://127.0.0.1:8000/version | jq .
```

---

## 5. Protected Prometheus Metrics (`/metrics`)

The metrics endpoint exposes low-cardinality Prometheus metrics in text format (`text/plain; version=0.0.4; charset=utf-8`).

### Access Protocol

* **Security Boundary:** The endpoint is protected by `METRICS_TOKEN`. Service API keys (`X-API-Key`) are strictly forbidden and will be rejected.
* **Fail-Closed:** If `METRICS_TOKEN` is unset in configuration, `/metrics` returns HTTP `404 Not Found`.

```bash
# Query metrics via Authorization Bearer header
curl -s -H "Authorization: Bearer your-metrics-token" http://127.0.0.1:8000/metrics

# Query metrics via X-Metrics-Token header
curl -s -H "X-Metrics-Token: your-metrics-token" http://127.0.0.1:8000/metrics
```

### Key Metrics to Monitor

| Metric Name | Type | Description |
|---|---|---|
| `onevue_http_requests_total` | Counter | Inbound requests by route, method, status class |
| `onevue_http_request_duration_seconds` | Histogram | Latency distribution of HTTP endpoints |
| `onevue_extraction_requests_total` | Counter | Total extractions labeled by status (`success`, `failure`) and error code |
| `onevue_provider_calls_total` | Counter | Outbound LLM provider calls by provider and call type (`extract`, `repair`) |
| `onevue_provider_failures_total` | Counter | Outbound provider failures by provider and error category |
| `onevue_provider_fallbacks_total` | Counter | Total failover events from Groq to NVIDIA |
| `onevue_circuit_breaker_state` | Gauge | Upstream circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN) |
| `onevue_concurrency_slots_in_use` | Gauge | Active concurrent PDF extractions currently running |

---

## 6. Diagnosing Missing Configuration

If the service returns `503 Service Unavailable` on `/ready`, inspect the returned `checks` dictionary:

1. **`checks.configuration == "missing_service_key"`:**
   * Cause: Neither `SERVICE_API_KEYS`, `LLM_SERVICE_API_KEY`, nor `SERVICE_API_KEY` is set.
   * Action: Set `SERVICE_API_KEYS="your-secret-key"` in `.env` or container environment and restart.
2. **`checks.provider == "missing_provider_credentials"`:**
   * Cause: `MOCK_MODE=false` and `GROQ_API_KEY` is missing or empty.
   * Action: Set `GROQ_API_KEY="your-groq-api-key"` or enable `MOCK_MODE=true` for local development.

---

## 7. Diagnosing Provider Errors, Throttling, and Circuit Breakers

When extraction fails, inspect structured JSON log events for diagnosis:

### A. Provider Authentication Failure (`502 PROVIDER_AUTH`)
* **Log Event:** `event="request_failed" http_status=502`
* **Cause:** Upstream `GROQ_API_KEY` is expired, revoked, or invalid.
* **Important:** Ineligible for fallback to NVIDIA. The service fails immediately without leaking the key.
* **Action:** Rotate the upstream `GROQ_API_KEY` credential in the hosting environment.

### B. Upstream Throttling (`429 PROVIDER_RATE_LIMITED`)
* **Log Event:** `event="provider_failure" error_category="rate_limit"`
* **Cause:** Groq tier RPM/TPM quota exhausted, or local `ProcessLocalRateGuard` (40 req/min) exceeded.
* **Mitigation:** The client should back off and retry. If frequent, request a tier increase from Groq or adjust `PROVIDER_RATE_LIMIT_PER_MINUTE`.

### C. Circuit Breaker Activation (`503 PROVIDER_UNAVAILABLE`)
* **Log Event:** `event="circuit_breaker_opened"` or `event="provider_fallback" error_category="circuit_open"`
* **Mechanism:** 3 consecutive transient failures (timeout, 5xx, or 429) trip the circuit to `OPEN` for a cooldown of `CIRCUIT_BREAKER_COOLDOWN_SECONDS` (30s).
* **Behavior:**
  * If NVIDIA fallback is enabled, requests transition to NVIDIA NIM (`event="provider_fallback"`).
  * If fallback is disabled or unavailable, requests immediately fail fast with `503` without contacting Groq.
* **Action:** Check status of upstream Groq API. The circuit breaker automatically tests recovery with a single probe request after cooldown expires.

---

## 8. Diagnosing PDF Parser Timeouts and Malformed Files

PDF extraction is isolated in a child subprocess via `multiprocessing` (spawn context).

1. **Parser Timeout (`400 INVALID_FILE: PDF parsing timed out after 15.0s`):**
   * Cause: Pathological PDF structure (complex vector shapes or nested objects) exceeded `PDF_PARSER_TIMEOUT_SECONDS`.
   * Action: The isolated worker process is terminated (SIGTERM/SIGKILL). The main service process remains unharmed. Advise candidate to simplify document or convert to standard PDF.
2. **Parser Crash (`400 INVALID_FILE: PDF parser worker terminated unexpectedly`):**
   * Cause: Corrupt binary stream or segmentation fault inside underlying C parser.
   * Action: Process fault was successfully isolated. Server continues serving other traffic.
3. **Scanned PDF (`422 SCANNED_PDF`):**
   * Cause: Document has no text layer (< 50 selectable characters).
   * Action: Advise user that image-only scanned PDFs require an accessible text layer. OCR is intentionally not bundled.

---

## 9. Service API Key Rotation Procedure

The service supports zero-downtime key rotation:

1. **Step 1:** Generate a cryptographically secure key:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
2. **Step 2:** Update the LLM service environment with both keys in `SERVICE_API_KEYS`:
   ```bash
   SERVICE_API_KEYS="new_key_value,old_key_value"
   ```
   Restart or reload the LLM service. Both keys are now valid.
3. **Step 3:** Update the integrating main ONEVUE application backend configuration with `new_key_value` and deploy.
4. **Step 4:** Verify that extraction calls from the main application succeed.
5. **Step 5:** Remove the old key from `SERVICE_API_KEYS`:
   ```bash
   SERVICE_API_KEYS="new_key_value"
   ```
   Restart or reload the LLM service. The old key is now rejected.

---

## 10. Manual Live Provider Check Script

> ⚠️ **LIVE CALL NOTICE:** This script makes **live provider calls** and consumes API credits. It is **never** run in automated tests or CI.

### Safety Boundaries Enforced by Script
* Requires explicit command-line acknowledgement (`--i-understand-live-calls`).
* Enforces a hard budget of **exactly one request** per run (0 retries).
* Uses 100% synthetic, in-memory candidate text.
* Zero personal data or real files are used.
* Never prints credentials, prompts, or raw responses.

### Execution

```bash
# Check Groq provider connectivity
./.venv/bin/python scripts/live_check.py --provider groq --i-understand-live-calls

# Check NVIDIA provider connectivity (if configured and enabled)
./.venv/bin/python scripts/live_check.py --provider nvidia --i-understand-live-calls
```

---

## 11. Mock-Only Load and Performance Test

### Safety Boundaries Enforced by Script
* Restricted exclusively to local loopback targets (`localhost`, `127.0.0.1`).
* Refuses to target remote internet URLs.
* Verifies target service is running in `MOCK_MODE=true`; aborts if in real mode.
* Bounded concurrency (≤ 50) and bounded request counts (≤ 1000).

### Execution

```bash
# In terminal 1: Start service in mock mode
export MOCK_MODE=true
export LLM_SERVICE_API_KEY="test-load-key"
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# In terminal 2: Run load test
./.venv/bin/python scripts/load_test.py \
  --url http://127.0.0.1:8000 \
  --api-key test-load-key \
  --concurrency 5 \
  --requests 50
```

---

## 12. Consented Real-Resume Evaluation Tool

Used for evaluating field-level extraction quality against benchmark reference labels.

### Privacy Protocol Enforced by Script
* **Filesystem Isolation:** The dataset directory and labels file **must reside strictly outside the repository tree**. Internal repository paths and symlinks are rejected.
* **Informed Consent:** Requires explicit candidate consent.
* **Anonymization:** Reference labels use anonymous case IDs (`case_001`). Real names, emails, and personal identifiers must not appear in label files.
* **Aggregate Reporting Only:** Prints aggregate precision, recall, and F1. Never prints resume text or PII.

### Execution

```bash
./.venv/bin/python scripts/evaluate_consented.py \
  --dataset-dir /path/outside/repo/consented_dataset \
  --labels-file /path/outside/repo/labels.json
```

---

## 13. PDF Extraction Backend Comparison Tool

Compares extraction speed, text layout ordering, and hyperlink detection between PyMuPDF (fitz) and PyPDFium2.

```bash
./.venv/bin/python scripts/compare_pdf_backends.py
```

Runs on a rich synthetic in-memory document with columns and hyperlinks. Generates technical difference reports without making remote network calls.

---

## 14. Process-Local Limitations and Multi-Worker Implications

The service includes safeguards that are intentionally implemented **in-memory and process-local**:
* `ExtractionConcurrencyLimiter`: Semaphore limiting active extractions (`MAX_CONCURRENT_EXTRACTIONS=2`).
* `ProcessLocalRateGuard`: Sliding-window limiter (`PROVIDER_RATE_LIMIT_PER_MINUTE=40`).
* `ProviderCircuitBreaker`: Failure count and cooldown tracker.

### Multi-Worker Architecture Notice

When deploying Uvicorn or Gunicorn with multiple worker processes (e.g., `--workers 4` or `WEB_CONCURRENCY=4`):
* State is **not shared** across processes.
* Effective global limits are multiplied by the number of workers (e.g., 4 workers × 2 concurrency = up to 8 concurrent extractions).
* At startup, `warn_multi_worker_if_detected()` logs an advisory warning if `WEB_CONCURRENCY > 1`.
* **Recommendation:** Deploy as single-worker containers scaled horizontally with external reverse-proxy rate limiting (e.g., Nginx, Envoy, or Cloudflare) if strict cluster-wide rate limits are required.

---

## 15. Service Shutdown and Cleanup

### Graceful Shutdown Sequence

When receiving `SIGTERM` or `SIGINT`:
1. `concurrency_limiter.initiate_shutdown()` stops accepting new requests (returns 503 with `Retry-After: 10`).
2. Ongoing extractions are granted time to complete within deadline.
3. `isolated_parser.shutdown()` terminates running parser subprocesses (SIGTERM, then SIGKILL after 3s).
4. Provider HTTP clients are cleanly closed.

### Temporary Data Cleanup

The service operates purely in memory. No persistent upload directories, database files, or scratch artifacts are created on the filesystem. No manual filesystem cleanup is required.
