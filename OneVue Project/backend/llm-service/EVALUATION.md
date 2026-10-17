# ONEVUE LLM Service — Evaluation, Live Checks, and PDF Backend Comparison Guide

This document defines the protocols, safety constraints, metric definitions, and execution runbooks for Phase 17 evaluation tools in `onevue-llm-service`.

---

## 1. Manual-Only Provider Live Checks

### Purpose & Scope
The manual live check tool (`scripts/live_check.py`) allows an authorized operator to verify basic reachability and structured-output capability of remote LLM providers (Groq and NVIDIA NIM). It is **strictly separated** from automated test suites and will never run during `pytest` or package imports.

### Safety Invariants
1. **Mandatory Explicit Acknowledgement**: Requires `--i-understand-live-calls`. Without this flag, the script exits immediately with status `2` and issues zero network calls.
2. **Hard Call Budget**: Exactly **one request** per selected provider per invocation. Retries, repairs, and fallbacks are strictly disabled (`max_retries=0`).
3. **100% Synthetic Content**: Uses hardcoded, minimal synthetic resume text (`Jordan Doe`, fictional contact and skills). Zero personal information, real resumes, or uploaded files are ever used.
4. **Credential & Prompt Redaction**: Output displays only provider name, success/failure category, elapsed latency in ms, model name, and token counts. It **never prints credentials, prompts, raw responses, or stack traces**.
5. **Production Policy Enforcement**: Respects `APP_ENV=production` restrictions. If `APP_ENV=production` and `NVIDIA_FALLBACK_ENABLED=False`, NVIDIA checks are blocked immediately.
6. **No Legal / Licensing Determination**: A successful network response proves only technical reachability, not licensing compliance, commercial approval, or terms of service acceptability.

### How to Run Safely
```bash
# Check Groq provider (default):
python scripts/live_check.py --i-understand-live-calls --provider groq

# Check NVIDIA NIM provider (dev/test only, or when explicitly allowed in prod):
python scripts/live_check.py --i-understand-live-calls --provider nvidia

# Check all configured providers:
python scripts/live_check.py --i-understand-live-calls --provider all
```

### Exact Requests Made
- **Groq**: One `POST /openai/v1/chat/completions` request using `GROQ_MODEL` with `response_format={"type": "json_object"}`.
- **NVIDIA**: One `POST /v1/chat/completions` request using `NVIDIA_MODEL` with `guided_json` schema matching `ResumeDraft`.

---

## 2. Mock-Only Load and Performance Testing

### Purpose & Scope
The load testing harness (`scripts/load_test.py`) benchmarks local service throughput and latency distributions without calling external LLM providers or incurring billing costs.

### Safety Invariants
1. **Loopback-Only Targets**: Strictly restricted to local loopback hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`). Any public IP or external domain is rejected immediately.
2. **Preflight Mock-Mode Gate**: Verifies `/health`, `/version`, and `/ready` before sending load. If the service is not in `MOCK_MODE=true` or is marked `environment="production"`, the test aborts immediately.
3. **Zero Provider Credentials**: Refuses any CLI flags that accept provider credentials.
4. **Bounded Concurrency & Duration**: Hard-capped at max 50 concurrent workers, max 1,000 total requests, and max 300 seconds duration to prevent accidental runaway execution.
5. **Synthetic In-Memory Payload**: Dynamically creates a minimal valid PDF in memory with PyMuPDF.

### How to Run Mock Load Tests
1. Start the service in mock mode in a local terminal:
   ```bash
   MOCK_MODE=true \
   SERVICE_API_KEYS="load-test-service-key" \
   METRICS_TOKEN="test-metrics-token" \
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
2. Execute the benchmark:
   ```bash
   python scripts/load_test.py \
     --target-url http://127.0.0.1:8000 \
     --concurrency 5 \
     --requests 50 \
     --service-key "load-test-service-key"
   ```

### Reported Metrics
- **Throughput**: Completed requests per second (`req/s`).
- **Latency Percentiles**: `min`, `p50` (median), `p90`, `p95`, `p99`, `max`, and `mean` in milliseconds.
- **Status Code Distribution**: HTTP 200, 4xx, 5xx counts, timeouts, and network errors.

> **Local Machine Disclaimer**: Benchmark results reflect local CPU and OS scheduling characteristics in mock mode. They do NOT reflect remote cloud latency, network jitter, or live provider inference speeds.

---

## 3. Consented Real-Resume Evaluation Harness

### Purpose & Scope
`scripts/evaluate_consented.py` provides an opt-in evaluation pipeline for evaluating extraction performance against a local dataset of real resumes supplied **strictly outside the repository**.

### Ethical, Consent, and Data Hygiene Protocol
1. **Informed Consent**: Every document in the dataset must have explicit, documented consent from the candidate authorizing automated parsing and extraction for system evaluation.
2. **Repository Isolation**: Dataset directories and label files must reside **strictly outside the repository**. Any path or symlink resolving inside the repository is immediately rejected.
3. **Anonymized Case IDs**: Reference label files must use non-identifying keys (e.g., `case_001`, `case_002`), never candidate names, emails, or phone numbers.
4. **Data Minimization & Zero Persistent Copies**: Resumes are read directly into memory from external paths and never copied, cached, or committed into the repository.
5. **Zero PII Disclosure**: Execution outputs and logs display only aggregate statistics. Raw candidate text, names, emails, and phone numbers are never printed or logged.
6. **Retention & Secure Deletion**: Operators must securely delete or shred external datasets and temporary label files once evaluation concludes.

### Reference Label Format
The external labels file (`anonymized_labels.json`) must follow this schema:
```json
{
  "case_001": {
    "emails": ["candidate1@example.com"],
    "phones": ["5550101"],
    "urls": ["https://linkedin.com/in/profile"],
    "skills": ["python", "docker", "fastapi"]
  }
}
```

### How to Run Consented Evaluation
```bash
python scripts/evaluate_consented.py \
  --i-confirm-consented-data \
  --dataset-path /absolute/path/to/external_consented_resumes/ \
  --labels-path /absolute/path/to/anonymized_labels.json
```

### Definitions & Limitations of Quality Metrics
- **Precision (P)**: $\frac{\text{True Positives}}{\text{True Positives} + \text{False Positives}}$ — Fraction of extracted items that were correct according to labels.
- **Recall (R)**: $\frac{\text{True Positives}}{\text{True Positives} + \text{False Negatives}}$ — Fraction of labeled items that the system successfully extracted.
- **F1 Score**: Harmonic mean of Precision and Recall: $\frac{2 \cdot P \cdot R}{P + R}$.
- **Missing-Field Rate**: Fraction of cases where an expected field was present in ground truth but omitted in the extracted draft.
- **Unsupported-Field Rate**: Fraction of cases where an extracted field had zero presence in the document or ground truth.

#### Limitations
- Metrics depend entirely on the completeness and consistency of external reference labels.
- Resumes frequently contain ambiguous dates (e.g., "Fall 2022") or implied skills not explicitly listed. The ONEVUE schema strictly drops ungrounded or ambiguous dates to `null` to prevent hallucination; naive ground truth that assumes inferred dates will lower measured recall.
- Synthetic accuracy is **not** a substitute for evaluation on consented, representative real-world documents.

---

## 4. Alternative PDF Backend Comparison

### Purpose & Scope
`scripts/compare_pdf_backends.py` evaluates whether the existing `PyMuPDF` dependency should be replaced with or augmented by an alternative backend such as `pypdfium2`.

### Technical Findings & Limitations
1. **Text Extraction & Vocabulary Overlap**:
   - Both `PyMuPDF` and `PyPDFium2` achieve **100% word vocabulary overlap** on structured multi-column text.
   - `PyMuPDF` employs coordinate-aware vertical and horizontal bounding box sorting (`_extract_page_text_column_aware`) to reconstruct reading order across multi-column layouts.
   - `PyPDFium2` extracts text in raw sequential textpage stream order, which can interleave columns on complex layouts unless custom geometry sorting is implemented.
2. **Hyperlink Annotations**:
   - `PyMuPDF` provides built-in link annotation traversal (`page.get_links()`) and bounding-box text clipping (`page.get_text(clip=rect)`). This is critical for recovering portfolio links, LinkedIn URLs, and email addresses embedded in link annotations.
   - `PyPDFium2` high-level Python bindings **do not expose hyperlink annotations or bounding box text clipping**. Social links and emails embedded only as PDF URI annotations cannot be extracted by `pypdfium2` without raw C FFI calls.
3. **Licensing Considerations**:
   - **PyMuPDF**: Licensed under **GNU AGPL-3.0** (or commercial license from Artifex). AGPL-3.0 copyleft terms may present architectural or commercial concerns depending on hosting topology.
   - **PyPDFium2**: Licensed under **Apache-2.0 / BSD-3-Clause** (permissive). No copyleft obligations.

### How to Run the Backend Comparison
```bash
# Compare using in-memory synthetic multi-column document with links:
python scripts/compare_pdf_backends.py

# Compare using an authorized local test file:
python scripts/compare_pdf_backends.py \
  --pdf-path /path/to/authorized_test.pdf \
  --i-confirm-authorized-document
```

### Recommendation & Status
- **Default Backend**: `PyMuPDF` remains the default (`PDF_BACKEND="pymupdf"`).
- **Alternative Backend**: `PyPDFium2Parser` is implemented as an experimental, opt-in backend (`PDF_BACKEND="pypdfium2"`).
- **Unresolved Licensing Decision**: The AGPL licensing question is documented as an unresolved decision for organizational legal counsel review. No legal conclusions are made.

---

## 5. Execution Status Summary

| Check / Evaluation Category | Execution Status | Actual Results Recorded |
|-----------------------------|------------------|-------------------------|
| **Unit & Contract Tests** | **EXECUTED (PASS)** | 548/548 tests passing via pytest. |
| **Lint & Formatting Checks** | **EXECUTED (PASS)** | Ruff clean (0 errors, 100% formatted). |
| **Synthetic PDF Comparison** | **EXECUTED (PASS)** | PyMuPDF (12.6ms) vs PyPDFium2 (96.2ms), 100% word overlap, 1 vs 0 links. |
| **Provider Live Checks** | **PENDING OPERATOR** | Offline tests verified; live calls pending operator `--i-understand-live-calls`. |
| **Mock Load Tests** | **PENDING OPERATOR** | Offline harness verified; local benchmark runnable on mock service. |
| **Consented Real-Resume Eval** | **PENDING OPERATOR** | Security harness verified; awaiting external consented dataset outside repo. |
