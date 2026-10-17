"""Isolated PDF parser running PyMuPDF extraction inside a separate worker process.

Guarantees and Isolation Boundaries:
1. Fault Isolation: Executes risky C-level PDF parsing (PyMuPDF) inside a separate
   worker process using 'spawn' multiprocessing context. A C-level crash, segfault,
   or memory corruption in the parser terminates only the worker process, leaving
   the main server process unharmed.
2. Hard Wall-Clock Timeout: Bounded wall-clock execution via pipe polling.
   If parsing exceeds PDF_PARSER_TIMEOUT_SECONDS, the worker process is
   forcibly terminated (SIGTERM, then SIGKILL) and cleaned up.
3. Bounded Concurrency: Bounded by PDF_PARSER_MAX_WORKERS to prevent fork bombs or
   unbounded process creation under heavy traffic.
4. Sanitized Errors: Worker crashes, timeouts, and extraction errors are mapped to
   safe, structured PDFExtractionError exceptions without exposing filesystem paths,
   stack traces, or parser internals.
5. OS Limitations: Wall-clock timeouts and crash containment are fully enforced.
   However, virtual memory limits cannot be portably enforced across all OS platforms
   without containerization or Linux cgroups.
"""

import logging
import multiprocessing
import threading
import time
from typing import Any

from app.config import Settings, get_settings
from app.extraction.pdf import (
    PDFExtractionError,
    PDFExtractionResult,
    PyMuPDFParser,
)
from app.schemas.errors import ErrorCode

logger = logging.getLogger(__name__)


def _isolated_worker_main(
    req_conn: Any,
    resp_conn: Any,
) -> None:
    """Entry point for isolated PDF parser worker process.

    Reads extraction payload from unidirectional req_conn pipe, parses PDF,
    and writes serialized result or error to unidirectional resp_conn pipe.
    Uses os.pipe() via duplex=False to avoid network socket interception.
    """
    try:
        payload = req_conn.recv()
        content: bytes = payload["content"]
        max_pages: int | None = payload.get("max_pages")
        max_text_chars: int | None = payload.get("max_text_chars")
        backend = payload.get("backend", "pymupdf")
        if backend == "pypdfium2":
            from app.extraction.pdfium_backend import PyPDFium2Parser

            parser = PyPDFium2Parser()
        else:
            parser = PyMuPDFParser()

        result = parser.extract(
            content,
            max_pages=max_pages,
            max_text_chars=max_text_chars,
        )

        resp_conn.send({"success": True, "data": result.model_dump()})
    except PDFExtractionError as exc:
        resp_conn.send(
            {
                "success": False,
                "error_type": "PDFExtractionError",
                "code": exc.code.value,
                "message": exc.message,
            }
        )
    except Exception as exc:
        logger.warning(
            "Isolated parser worker caught unexpected exception: %s",
            type(exc).__name__,
        )
        resp_conn.send(
            {
                "success": False,
                "error_type": "Exception",
                "code": ErrorCode.INVALID_FILE.value,
                "message": (
                    "Failed to parse PDF document. Document structure is corrupted "
                    "or unreadable."
                ),
            }
        )
    finally:
        try:
            req_conn.close()
        except Exception:
            pass
        try:
            resp_conn.close()
        except Exception:
            pass


class IsolatedPDFParser:
    """PDF parser running PyMuPDF extraction inside a bounded worker process."""

    def __init__(
        self,
        settings: Settings | None = None,
        timeout_seconds: float | None = None,
        max_workers: int | None = None,
    ) -> None:
        """Initialize isolated parser with configurable timeout and worker limit."""
        cfg = settings or get_settings()
        self._settings = cfg
        self.timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else cfg.PDF_PARSER_TIMEOUT_SECONDS
        )
        self.max_workers = (
            max_workers if max_workers is not None else cfg.PDF_PARSER_MAX_WORKERS
        )
        self._semaphore = threading.BoundedSemaphore(self.max_workers)
        self._active_workers: set[multiprocessing.Process] = set()
        self._lock = threading.Lock()

    def shutdown(self, timeout: float = 3.0) -> None:
        """Terminate all running worker processes during service shutdown."""
        with self._lock:
            workers = list(self._active_workers)

        for worker in workers:
            if worker.is_alive():
                try:
                    worker.terminate()
                    worker.join(timeout=timeout)
                    if worker.is_alive():
                        worker.kill()
                        worker.join(timeout=1.0)
                except Exception as exc:
                    logger.warning("Error terminating parser worker: %s", exc)

        with self._lock:
            self._active_workers.clear()

    def reset_shutdown(self) -> None:
        """Reset state on startup or test reset."""
        with self._lock:
            self._active_workers.clear()

    def extract(
        self,
        content: bytes,
        *,
        max_pages: int | None = None,
        max_text_chars: int | None = None,
    ) -> PDFExtractionResult:
        """Extract text and hyperlinks from raw PDF bytes inside an isolated worker.

        Args:
            content: Raw PDF bytes.
            max_pages: Maximum permitted pages.
            max_text_chars: Maximum permitted characters.

        Returns:
            PDFExtractionResult from worker process.

        Raises:
            PDFExtractionError: On parsing errors, timeout, or worker termination.
        """
        # 1. Acquire bounded worker slot (reject if queue wait exceeds 5s)
        slot_acquired = self._semaphore.acquire(blocking=True, timeout=5.0)
        if not slot_acquired:
            raise PDFExtractionError(
                code=ErrorCode.INVALID_FILE,
                message="PDF parsing concurrency limit reached. Please retry later.",
            )

        worker: multiprocessing.Process | None = None
        req_read: Any = None
        req_write: Any = None
        resp_read: Any = None
        resp_write: Any = None

        try:
            # 2. Spawn worker process using unidirectional pipes (os.pipe)
            ctx = multiprocessing.get_context("spawn")
            req_read, req_write = ctx.Pipe(duplex=False)
            resp_read, resp_write = ctx.Pipe(duplex=False)

            worker = ctx.Process(
                target=_isolated_worker_main,
                args=(req_read, resp_write),
                daemon=True,
            )

            with self._lock:
                self._active_workers.add(worker)

            worker.start()
            # Close child ends in parent process
            req_read.close()
            req_read = None
            resp_write.close()
            resp_write = None

            # 3. Transmit extraction payload
            backend = (
                getattr(self._settings, "PDF_BACKEND", "pymupdf")
                if self._settings
                else "pymupdf"
            )
            req_write.send(
                {
                    "content": content,
                    "max_pages": max_pages,
                    "max_text_chars": max_text_chars,
                    "backend": backend,
                }
            )
            req_write.close()
            req_write = None

            # 4. Wait for response under hard wall-clock timeout
            start_poll = time.monotonic()
            poll_result = resp_read.poll(self.timeout_seconds)
            elapsed = time.monotonic() - start_poll

            if not poll_result:
                # Wall-clock timeout exceeded: kill worker process
                logger.warning(
                    "Isolated PDF parser timed out after %.2fs. "
                    "Terminating worker PID %s.",
                    elapsed,
                    getattr(worker, "pid", "unknown"),
                )
                self._terminate_worker(worker)
                raise PDFExtractionError(
                    code=ErrorCode.INVALID_FILE,
                    message=(
                        f"PDF parsing timed out after {self.timeout_seconds:.1f}s. "
                        "The document could not be processed within the deadline."
                    ),
                )

            # 5. Receive response from worker
            try:
                response = resp_read.recv()
            except (EOFError, ConnectionResetError) as exc:
                self._terminate_worker(worker)
                raise PDFExtractionError(
                    code=ErrorCode.INVALID_FILE,
                    message="PDF parser worker terminated unexpectedly.",
                ) from exc

            # Ensure worker joins cleanly
            worker.join(timeout=1.0)
            if worker.is_alive():
                self._terminate_worker(worker)

            # 6. Parse and return result or raise sanitized error
            if response.get("success"):
                return PDFExtractionResult.model_validate(response["data"])

            err_code_str = response.get("code", ErrorCode.INVALID_FILE.value)
            try:
                err_code = ErrorCode(err_code_str)
            except ValueError:
                err_code = ErrorCode.INVALID_FILE

            raise PDFExtractionError(
                code=err_code,
                message=response.get("message", "PDF extraction failed."),
            )

        except PDFExtractionError:
            raise
        except Exception as exc:
            logger.error(
                "Unexpected error in isolated PDF parsing: %s", type(exc).__name__
            )
            if worker is not None and worker.is_alive():
                self._terminate_worker(worker)
            raise PDFExtractionError(
                code=ErrorCode.INVALID_FILE,
                message="An error occurred while parsing the PDF document.",
            ) from exc
        finally:
            for p in (req_read, req_write, resp_read, resp_write):
                if p is not None:
                    try:
                        p.close()
                    except Exception:
                        pass
            if worker is not None:
                with self._lock:
                    self._active_workers.discard(worker)
            self._semaphore.release()

    def _terminate_worker(self, worker: multiprocessing.Process) -> None:
        """Safely terminate and join a worker process."""
        try:
            if worker.is_alive():
                worker.terminate()
                worker.join(timeout=0.5)
                if worker.is_alive():
                    worker.kill()
                    worker.join(timeout=0.5)
        except Exception as exc:
            logger.warning("Error terminating worker process: %s", exc)


# Module-level singleton and accessor
_PARSER_INSTANCE: IsolatedPDFParser | None = None
_PARSER_LOCK = threading.Lock()


def get_isolated_pdf_parser(settings: Settings | None = None) -> IsolatedPDFParser:
    """Return singleton IsolatedPDFParser instance."""
    global _PARSER_INSTANCE
    with _PARSER_LOCK:
        if _PARSER_INSTANCE is None:
            _PARSER_INSTANCE = IsolatedPDFParser(settings=settings)
        return _PARSER_INSTANCE


def reset_isolated_pdf_parser() -> None:
    """Reset singleton parser instance (for test isolation)."""
    global _PARSER_INSTANCE
    with _PARSER_LOCK:
        if _PARSER_INSTANCE is not None:
            _PARSER_INSTANCE.shutdown()
            _PARSER_INSTANCE = None
