"""Tests for Phase 15 extraction concurrency limits, timeouts, and deadlines."""

import asyncio

import pytest

from app.api.errors import ServiceAPIError
from app.orchestration.concurrency import (
    ExtractionConcurrencyLimiter,
    get_remaining_deadline_seconds,
    is_deadline_exceeded,
)
from app.schemas.errors import ErrorCode


class TestExtractionConcurrencyLimiter:
    """Test ExtractionConcurrencyLimiter bounded concurrency, timeouts, and cleanup."""

    @pytest.mark.anyio
    async def test_concurrency_saturation_and_queue_timeout(self):
        """Verify that excess requests time out and receive 503 with Retry-After."""
        limiter = ExtractionConcurrencyLimiter(
            max_concurrent=2,
            acquire_timeout_seconds=0.1,
            deadline_seconds=5.0,
        )

        hold_event = asyncio.Event()

        async def worker():
            await hold_event.wait()
            return "done"

        # Spawn 2 tasks that hold both slots
        task1 = asyncio.create_task(limiter.run(worker))
        task2 = asyncio.create_task(limiter.run(worker))

        # Give tasks a moment to acquire slots
        await asyncio.sleep(0.02)

        # 3rd task should exceed concurrency and time out after 0.1s
        with pytest.raises(ServiceAPIError) as exc_info:
            await limiter.run(worker)

        err = exc_info.value
        assert err.status_code == 503
        assert err.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert "Retry-After" in err.headers
        assert err.headers["Retry-After"] == "5"

        # Release holding tasks and verify they complete cleanly
        hold_event.set()
        res1 = await task1
        res2 = await task2
        assert res1 == "done"
        assert res2 == "done"

        # Semaphore must be fully released: subsequent request succeeds immediately
        res3 = await limiter.run(lambda: asyncio.sleep(0.01, result="success"))
        assert res3 == "success"

    @pytest.mark.anyio
    async def test_overall_request_deadline_enforcement(self):
        """Verify that requests exceeding overall deadline abort with 504."""
        limiter = ExtractionConcurrencyLimiter(
            max_concurrent=1,
            acquire_timeout_seconds=1.0,
            deadline_seconds=0.1,
        )

        async def slow_operation():
            # Operation that takes longer than 0.1s deadline
            await asyncio.sleep(0.5)
            return "too_slow"

        with pytest.raises(ServiceAPIError) as exc_info:
            await limiter.run(slow_operation)

        err = exc_info.value
        assert err.status_code == 504
        assert err.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert "overall deadline" in err.message

        # Verify semaphore slot was cleanly released after deadline timeout
        res = await limiter.run(lambda: asyncio.sleep(0.01, result="subsequent_ok"))
        assert res == "subsequent_ok"

    @pytest.mark.anyio
    async def test_deadline_contextvars_tracking(self):
        """Verify remaining deadline and is_deadline_exceeded track deadline."""
        limiter = ExtractionConcurrencyLimiter(
            max_concurrent=1,
            acquire_timeout_seconds=1.0,
            deadline_seconds=2.0,
        )

        assert not is_deadline_exceeded()
        assert get_remaining_deadline_seconds() == float("inf")

        observed_remaining = None
        observed_exceeded = None

        async def check_deadline():
            nonlocal observed_remaining, observed_exceeded
            observed_remaining = get_remaining_deadline_seconds()
            observed_exceeded = is_deadline_exceeded()
            return "checked"

        result = await limiter.run(check_deadline)
        assert result == "checked"
        assert observed_remaining is not None
        assert 0.0 < observed_remaining <= 2.0
        assert observed_exceeded is False

        # Outside the run context, deadline contextvar is reset
        assert not is_deadline_exceeded()
        assert get_remaining_deadline_seconds() == float("inf")

    @pytest.mark.anyio
    async def test_cancellation_safety(self):
        """Verify that client cancellation does not leak semaphores."""
        limiter = ExtractionConcurrencyLimiter(
            max_concurrent=1,
            acquire_timeout_seconds=1.0,
            deadline_seconds=5.0,
        )

        task = asyncio.create_task(limiter.run(lambda: asyncio.sleep(10.0)))
        await asyncio.sleep(0.02)

        # Cancel active task
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        # Slot must be released and available for next request
        next_res = await limiter.run(lambda: asyncio.sleep(0.01, result="recovered"))
        assert next_res == "recovered"

    @pytest.mark.anyio
    async def test_shutdown_rejection(self):
        """Verify limiter rejects requests immediately when shutdown is initiated."""
        limiter = ExtractionConcurrencyLimiter(
            max_concurrent=2,
            acquire_timeout_seconds=1.0,
            deadline_seconds=5.0,
        )

        limiter.initiate_shutdown()

        with pytest.raises(ServiceAPIError) as exc_info:
            await limiter.run(lambda: asyncio.sleep(0.01, result="never"))

        err = exc_info.value
        assert err.status_code == 503
        assert err.code == ErrorCode.PROVIDER_UNAVAILABLE
        assert err.headers.get("Retry-After") == "5"

        # Re-enabling via reset_shutdown allows requests again
        limiter.reset_shutdown()
        res = await limiter.run(lambda: asyncio.sleep(0.01, result="ok"))
        assert res == "ok"
