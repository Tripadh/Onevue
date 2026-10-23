"""Mock-only load and performance testing harness for ONEVUE LLM Service.

SAFETY GUARANTEES:
- Strictly exercises mock mode only.
- Explicitly rejects remote or public internet target URLs (loopback only).
- Refuses to run if target service is in production mode or not in mock mode.
- Does not accept or use provider credentials.
- Bounded concurrency (<= 50) and bounded request counts (<= 1000) to prevent runaways.
- Uses 100% synthetic in-memory test documents only.
"""

import argparse
import asyncio
import os
import sys
import time
from typing import Any
from urllib.parse import urlparse

import httpx
import pymupdf

# Ensure project root is on sys.path
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_CURRENT_DIR)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

ALLOWED_LOCAL_HOSTS = frozenset(
    {"localhost", "127.0.0.1", "0.0.0.0", "::1", "testclient"}
)

MAX_SAFE_CONCURRENCY = 50
MAX_SAFE_REQUESTS = 1000
MAX_SAFE_DURATION_SECONDS = 300.0


def validate_target_url(url: str) -> str:
    """Validate that the target URL is strictly a local loopback address.

    Raises:
        ValueError: If scheme is unsupported or host is not an allowed local loopback.
    """
    if not url or not url.strip():
        raise ValueError("Target URL cannot be empty.")

    clean_url = url.strip()
    parsed = urlparse(clean_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(
            f"Unsupported URL scheme '{parsed.scheme}'. Target must use http or https."
        )

    host = (parsed.hostname or "").lower()
    if not host or host not in ALLOWED_LOCAL_HOSTS:
        raise ValueError(
            f"Unsafe target host '{host}'. Load testing is strictly restricted "
            f"to local loopback targets: {sorted(ALLOWED_LOCAL_HOSTS)}."
        )

    return clean_url.rstrip("/")


def generate_synthetic_test_pdf() -> bytes:
    """Generate a minimal synthetic PDF document in-memory for testing."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (50, 72),
        "Alex Doe\n"
        "Software Engineer\n"
        "Email: alex.synthetic.test@example.com\n"
        "Phone: (555) 019-2831\n"
        "Skills: Python, TypeScript, Docker\n"
        "Experience: Software Engineer at Acme Corp (2020 - 2023)\n"
        "- Developed backend microservices and APIs.",
    )
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def calculate_percentiles(latencies_ms: list[float]) -> dict[str, float]:
    """Calculate key latency percentiles from a list of measurements."""
    if not latencies_ms:
        return {
            "min": 0.0,
            "p50": 0.0,
            "p90": 0.0,
            "p95": 0.0,
            "p99": 0.0,
            "max": 0.0,
            "mean": 0.0,
        }

    sorted_lat = sorted(latencies_ms)
    n = len(sorted_lat)

    def _get_p(p: float) -> float:
        idx = int(round((p / 100.0) * (n - 1)))
        idx = max(0, min(idx, n - 1))
        return sorted_lat[idx]

    return {
        "min": round(sorted_lat[0], 2),
        "p50": round(_get_p(50), 2),
        "p90": round(_get_p(90), 2),
        "p95": round(_get_p(95), 2),
        "p99": round(_get_p(99), 2),
        "max": round(sorted_lat[-1], 2),
        "mean": round(sum(sorted_lat) / n, 2),
    }


async def verify_target_safety_preflight(
    client: httpx.AsyncClient, base_url: str
) -> None:
    """Verify that target service is running, local, non-production, and in mock mode.

    Raises:
        ValueError: If service is not ready, is in production, or is not in mock mode.
    """
    # 1. Health check
    try:
        health_resp = await client.get(f"{base_url}/health")
        if health_resp.status_code != 200:
            raise ValueError(
                f"Health check failed on target: HTTP {health_resp.status_code}"
            )
    except httpx.RequestError as exc:
        raise ValueError(
            f"Cannot reach target service at {base_url}/health: {exc}"
        ) from exc

    # 2. Version and Environment check
    try:
        version_resp = await client.get(f"{base_url}/version")
        if version_resp.status_code == 200:
            env = version_resp.json().get("environment", "").lower()
            if env == "production":
                raise ValueError(
                    "Target service environment is 'production'. "
                    "Load testing against production environments is strictly "
                    "forbidden."
                )
    except httpx.RequestError as exc:
        raise ValueError(f"Failed to query {base_url}/version: {exc}") from exc

    # 3. Readiness and Mock Mode check
    try:
        ready_resp = await client.get(f"{base_url}/ready")
        if ready_resp.status_code in (200, 503):
            data = ready_resp.json()
            checks = data.get("checks", {})
            mock_mode = str(checks.get("mock_mode", "")).lower()
            if mock_mode != "true":
                raise ValueError(
                    f"Target service is NOT in mock mode "
                    f"(checks.mock_mode={mock_mode!r}). "
                    "Load testing is strictly forbidden against non-mock "
                    "services to prevent incurring external provider billing."
                )
        else:
            raise ValueError(
                f"Unexpected readiness status: HTTP {ready_resp.status_code}"
            )
    except httpx.RequestError as exc:
        raise ValueError(f"Failed to query {base_url}/ready: {exc}") from exc


async def run_load_test(
    base_url: str,
    concurrency: int,
    total_requests: int,
    timeout_seconds: float = 5.0,
    service_key: str = "load-test-service-key",
    max_duration_seconds: float = MAX_SAFE_DURATION_SECONDS,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Execute bounded mock load test against target service."""
    clean_url = validate_target_url(base_url)

    if concurrency < 1 or concurrency > MAX_SAFE_CONCURRENCY:
        raise ValueError(
            f"Concurrency must be between 1 and {MAX_SAFE_CONCURRENCY}. "
            f"Given: {concurrency}"
        )
    if total_requests < 1 or total_requests > MAX_SAFE_REQUESTS:
        raise ValueError(
            f"Total requests must be between 1 and {MAX_SAFE_REQUESTS}. "
            f"Given: {total_requests}"
        )

    pdf_bytes = generate_synthetic_test_pdf()

    async def _execute_with_client(http_client: httpx.AsyncClient) -> dict[str, Any]:
        # Preflight verification
        await verify_target_safety_preflight(http_client, clean_url)

        semaphore = asyncio.Semaphore(concurrency)
        latencies: list[float] = []
        status_codes: dict[int, int] = {}
        timeouts = 0
        connection_errors = 0
        completed = 0

        start_time = time.perf_counter()

        async def worker(request_idx: int) -> None:
            nonlocal timeouts, connection_errors, completed
            # Enforce max duration safety bound
            if (time.perf_counter() - start_time) > max_duration_seconds:
                return

            async with semaphore:
                req_start = time.perf_counter()
                files = {"file": ("synthetic_resume.pdf", pdf_bytes, "application/pdf")}
                headers = {"X-API-Key": service_key}

                try:
                    resp = await http_client.post(
                        f"{clean_url}/v1/extract",
                        files=files,
                        headers=headers,
                        timeout=timeout_seconds,
                    )
                    req_duration_ms = (time.perf_counter() - req_start) * 1000.0
                    latencies.append(req_duration_ms)
                    status_codes[resp.status_code] = (
                        status_codes.get(resp.status_code, 0) + 1
                    )
                except httpx.TimeoutException:
                    timeouts += 1
                except httpx.RequestError:
                    connection_errors += 1
                finally:
                    completed += 1

        tasks = [worker(i) for i in range(total_requests)]
        await asyncio.gather(*tasks)

        total_elapsed = time.perf_counter() - start_time
        successful = status_codes.get(200, 0)
        throughput_rps = (
            round(len(latencies) / total_elapsed, 2) if total_elapsed > 0 else 0.0
        )

        return {
            "target_url": clean_url,
            "concurrency": concurrency,
            "total_requested": total_requests,
            "completed": completed,
            "successful": successful,
            "status_codes": status_codes,
            "timeouts": timeouts,
            "connection_errors": connection_errors,
            "total_elapsed_seconds": round(total_elapsed, 3),
            "throughput_rps": throughput_rps,
            "latencies_ms": calculate_percentiles(latencies),
        }

    if client is not None:
        return await _execute_with_client(client)

    async with httpx.AsyncClient() as new_client:
        return await _execute_with_client(new_client)


def print_load_test_results(results: dict[str, Any]) -> None:
    """Format and print human-readable load test benchmark results."""
    print("\n" + "=" * 65)
    print(" ONEVUE LLM SERVICE — MOCK LOAD TEST BENCHMARK RESULTS")
    print("=" * 65)
    print(f" Target URL          : {results['target_url']}")
    print(f" Concurrency         : {results['concurrency']}")
    print(f" Total Requests      : {results['total_requested']}")
    print(f" Total Completed     : {results['completed']}")
    print(f" Successful (HTTP 200: {results['successful']}")
    print(f" Elapsed Time        : {results['total_elapsed_seconds']} s")
    print(f" Throughput          : {results['throughput_rps']} req/s")
    print("-" * 65)
    print(" STATUS CODE DISTRIBUTION:")
    for code, count in sorted(results["status_codes"].items()):
        print(f"   HTTP {code}: {count}")
    if results["timeouts"] > 0:
        print(f"   Timeouts: {results['timeouts']}")
    if results["connection_errors"] > 0:
        print(f"   Connection Errors: {results['connection_errors']}")
    print("-" * 65)
    lat = results["latencies_ms"]
    print(" LATENCY DISTRIBUTION (ms):")
    print(f"   Min      : {lat['min']:.2f} ms")
    print(f"   p50 (med): {lat['p50']:.2f} ms")
    print(f"   p90      : {lat['p90']:.2f} ms")
    print(f"   p95      : {lat['p95']:.2f} ms")
    print(f"   p99      : {lat['p99']:.2f} ms")
    print(f"   Max      : {lat['max']:.2f} ms")
    print(f"   Mean     : {lat['mean']:.2f} ms")
    print("=" * 65)
    print(
        " NOTE:\n"
        " These measurements are strictly specific to this local machine and\n"
        " the mock-mode test harness configuration. Mock execution bypasses\n"
        " remote network latency and LLM inference time. Do not treat local\n"
        " mock throughput as a production capacity guarantee.\n"
        "=================================================================\n"
    )


def parse_args(args: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI arguments for load test script."""
    parser = argparse.ArgumentParser(
        description="ONEVUE mock-only load and latency benchmark testing."
    )
    parser.add_argument(
        "--target-url",
        default="http://127.0.0.1:8000",
        help="Target base URL (must be local loopback, e.g. http://127.0.0.1:8000).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help=f"Concurrent workers (1 to {MAX_SAFE_CONCURRENCY}, default: 5).",
    )
    parser.add_argument(
        "--requests",
        type=int,
        default=25,
        help=(
            f"Total synthetic requests to send (1 to {MAX_SAFE_REQUESTS}, default: 25)."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=5.0,
        help="Per-request timeout in seconds (default: 5.0).",
    )
    parser.add_argument(
        "--service-key",
        default="load-test-service-key",
        help="Service API key configured on local service for authentication.",
    )
    return parser.parse_args(args)


def main() -> int:
    """Main CLI entrypoint."""
    args = parse_args()
    try:
        results = asyncio.run(
            run_load_test(
                base_url=args.target_url,
                concurrency=args.concurrency,
                total_requests=args.requests,
                timeout_seconds=args.timeout,
                service_key=args.service_key,
            )
        )
        print_load_test_results(results)
        return 0
    except Exception as exc:
        sys.stderr.write(f"\n[LOAD TEST ERROR] {exc}\n\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
