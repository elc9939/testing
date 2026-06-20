from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from ..machine_modes import machine_mode_policy, merged_machine_mode_metadata
from ..models import JobCreateRequest, JobSnapshot, JobStatus, new_id, now_iso
from ..storage import AppStorage

JobHandler = Callable[[str, JobCreateRequest, "JobQueue"], Awaitable[list[Any]]]


class JobQueue:
    def __init__(
        self,
        storage: AppStorage,
        max_concurrency: int = 4,
        max_active_jobs: int = 20,
        job_timeout_s: float = 1800.0,
        max_results_per_job: int = 2000,
    ):
        self.storage = storage
        self.max_concurrency = max(1, max_concurrency)
        self.max_active_jobs = max(1, max_active_jobs)
        self.job_timeout_s = max(1.0, job_timeout_s)
        self.max_results_per_job = max(1, max_results_per_job)
        self._jobs: dict[str, JobSnapshot] = {}
        self._results: dict[str, list[Any]] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._handlers: dict[str, JobHandler] = {}
        self._lock = asyncio.Lock()

    def register(self, primitive: str, handler: JobHandler) -> None:
        self._handlers[primitive] = handler

    async def create(self, request: JobCreateRequest) -> JobSnapshot:
        mode_metadata = merged_machine_mode_metadata(request.request.metadata, request.metadata)
        policy = machine_mode_policy(mode_metadata)
        if policy.max_job_concurrency is not None and request.concurrency is not None and request.concurrency > policy.max_job_concurrency:
            request = request.model_copy(update={"concurrency": policy.max_job_concurrency})
        request = request.model_copy(
            update={
                "request": request.request.model_copy(update={"metadata": mode_metadata}),
                "metadata": mode_metadata,
            }
        )
        if request.primitive not in self._handlers:
            raise ValueError(f"Unknown job primitive: {request.primitive}")
        active = sum(1 for job in self._jobs.values() if job.status in {"queued", "running"})
        if active >= self.max_active_jobs:
            raise ValueError(f"Too many active jobs ({active}); limit is {self.max_active_jobs}.")
        job_id = new_id("job")
        total = len(request.items) if request.primitive == "map" else request.n if request.primitive == "self_consistency" else 1
        snapshot = JobSnapshot(
            id=job_id,
            primitive=request.primitive,
            status="queued",
            created_at=now_iso(),
            updated_at=now_iso(),
            total=max(1, total),
            metadata=request.metadata,
        )
        async with self._lock:
            self._jobs[job_id] = snapshot
            self._results[job_id] = []
            self._tasks[job_id] = asyncio.create_task(self._run(job_id, request))
        self.storage.log_job_event(job_id, "info", "queued", request.model_dump(mode="json"))
        return snapshot

    async def _run(self, job_id: str, request: JobCreateRequest) -> None:
        await self.update(job_id, status="running")
        try:
            results = await asyncio.wait_for(
                self._handlers[request.primitive](job_id, request, self),
                timeout=self.job_timeout_s,
            )
            self._results[job_id] = results
            status: JobStatus = "cancelled" if self._jobs[job_id].cancel_requested else "succeeded"
            await self.update(job_id, status=status, completed=self._jobs[job_id].total, progress=1)
            self.storage.log_job_event(job_id, "info", status, {"results": len(results)})
        except asyncio.CancelledError:
            await self.update(job_id, status="cancelled")
            self.storage.log_job_event(job_id, "warning", "cancelled")
        except TimeoutError:
            await self.update(job_id, status="failed", error=f"Job exceeded timeout of {self.job_timeout_s} seconds.")
            self.storage.log_job_event(job_id, "error", "timeout", {"timeout_s": self.job_timeout_s})
        except Exception as error:
            await self.update(job_id, status="failed", error=str(error))
            self.storage.log_job_event(job_id, "error", "failed", {"error": str(error)})

    async def update(self, job_id: str, **patch: Any) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            values = job.model_dump()
            values.update(patch)
            values["updated_at"] = now_iso()
            if "completed" in values and values.get("total", 0):
                values["progress"] = min(1.0, values["completed"] / values["total"])
            self._jobs[job_id] = JobSnapshot(**values)

    async def append_result(self, job_id: str, result: Any) -> None:
        async with self._lock:
            if len(self._results.setdefault(job_id, [])) >= self.max_results_per_job:
                raise RuntimeError(f"Job result limit exceeded ({self.max_results_per_job}).")
            self._results.setdefault(job_id, []).append(result)
            job = self._jobs[job_id]
            awaitable = None
            completed = min(job.total, job.completed + 1)
            values = job.model_dump()
            values.update({"completed": completed, "updated_at": now_iso(), "progress": completed / max(1, job.total)})
            self._jobs[job_id] = JobSnapshot(**values)
        if awaitable:
            await awaitable

    async def fail_one(self, job_id: str) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            values = job.model_dump()
            values.update({"failed": job.failed + 1, "updated_at": now_iso()})
            self._jobs[job_id] = JobSnapshot(**values)

    def get(self, job_id: str) -> JobSnapshot | None:
        return self._jobs.get(job_id)

    def list(self) -> list[JobSnapshot]:
        return sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)

    def results(self, job_id: str) -> list[Any]:
        return self._results.get(job_id, [])

    async def cancel(self, job_id: str) -> JobSnapshot:
        async with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            values = self._jobs[job_id].model_dump()
            values.update({"cancel_requested": True, "updated_at": now_iso()})
            self._jobs[job_id] = JobSnapshot(**values)
            task = self._tasks.get(job_id)
            if task:
                task.cancel()
            return self._jobs[job_id]

    def cancel_requested(self, job_id: str) -> bool:
        return bool(self._jobs.get(job_id) and self._jobs[job_id].cancel_requested)

    def metrics(self) -> dict[str, Any]:
        counts = {
            "queued": 0,
            "running": 0,
            "succeeded": 0,
            "failed": 0,
            "cancelled": 0,
        }
        for job in self._jobs.values():
            counts[job.status] += 1
        total_finished = counts["succeeded"] + counts["failed"] + counts["cancelled"]
        return {
            "ok": counts["failed"] == 0,
            "queue_depth": counts["queued"] + counts["running"],
            "max_active_jobs": self.max_active_jobs,
            "max_concurrency": self.max_concurrency,
            "counts": counts,
            "success_rate": counts["succeeded"] / total_finished if total_finished else None,
        }
