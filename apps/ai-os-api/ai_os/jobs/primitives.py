from __future__ import annotations

import asyncio
from typing import Any

from ..inference import InferenceRouter
from ..machine_modes import machine_mode_policy, merged_machine_mode_metadata
from ..models import ChatMessage, InferenceRequest, JobCreateRequest
from .queue import JobQueue


def clone_request(request: InferenceRequest, prompt: str, metadata: dict[str, Any] | None = None) -> InferenceRequest:
    values = request.model_dump()
    values["prompt"] = prompt
    values["messages"] = [ChatMessage(role="user", content=prompt).model_dump()]
    values["metadata"] = merged_machine_mode_metadata(request.metadata, metadata)
    return InferenceRequest(**values)


def render_template(template: str | None, item: str, index: int) -> str:
    template = template or "{item}"
    return template.replace("{item}", item).replace("{index}", str(index))


class JobPrimitives:
    def __init__(self, router: InferenceRouter):
        self.router = router

    async def map(self, job_id: str, request: JobCreateRequest, queue: JobQueue) -> list[Any]:
        policy = machine_mode_policy(merged_machine_mode_metadata(request.request.metadata, request.metadata))
        desired_concurrency = request.concurrency or queue.max_concurrency
        if policy.max_job_concurrency is not None:
            desired_concurrency = min(desired_concurrency, policy.max_job_concurrency)
        semaphore = asyncio.Semaphore(max(1, desired_concurrency))
        results: list[Any] = []

        async def run_one(index: int, item: str) -> None:
            if queue.cancel_requested(job_id):
                return
            async with semaphore:
                try:
                    prompt = render_template(request.template, item, index)
                    result = await self.router.infer(clone_request(request.request, prompt, request.metadata))
                    payload = {"index": index, "item": item, "result": result.model_dump(mode="json")}
                    results.append(payload)
                    await queue.append_result(job_id, payload)
                except Exception as error:
                    await queue.fail_one(job_id)
                    results.append({"index": index, "item": item, "error": str(error)})

        await asyncio.gather(*(run_one(index, item) for index, item in enumerate(request.items)))
        return results

    async def self_consistency(self, job_id: str, request: JobCreateRequest, queue: JobQueue) -> list[Any]:
        results: list[Any] = []
        for index in range(max(1, request.n)):
            if queue.cancel_requested(job_id):
                break
            result = await self.router.infer(request.request.model_copy(update={"metadata": merged_machine_mode_metadata(request.request.metadata, request.metadata)}))
            payload = {"index": index, "candidate": result.model_dump(mode="json")}
            results.append(payload)
            await queue.append_result(job_id, payload)
        aggregate = "\n\n".join(item["candidate"]["text"] for item in results if "candidate" in item)
        results.append({"aggregate": aggregate})
        return results

    async def chunk_summarize(self, job_id: str, request: JobCreateRequest, queue: JobQueue) -> list[Any]:
        text = request.text or request.request.prompt or ""
        chunks = [text[index : index + request.chunk_size] for index in range(0, len(text), request.chunk_size)] or [text]
        summaries: list[str] = []
        await queue.update(job_id, total=len(chunks) + 1)
        for index, chunk in enumerate(chunks):
            if queue.cancel_requested(job_id):
                break
            prompt = f"Summarize this chunk without adding new claims:\n\n{chunk}"
            result = await self.router.infer(clone_request(request.request, prompt, request.metadata))
            summaries.append(result.text)
            await queue.append_result(job_id, {"index": index, "summary": result.model_dump(mode="json")})
        final_prompt = "Combine these chunk summaries into one concise synthesis:\n\n" + "\n\n".join(summaries)
        final = await self.router.infer(clone_request(request.request, final_prompt, request.metadata))
        payload = {"final": final.model_dump(mode="json")}
        await queue.append_result(job_id, payload)
        return [*queue.results(job_id), payload]

    async def retry_loop(self, job_id: str, request: JobCreateRequest, queue: JobQueue) -> list[Any]:
        errors: list[str] = []
        for attempt in range(max(1, request.max_retries)):
            if queue.cancel_requested(job_id):
                break
            try:
                result = await self.router.infer(request.request.model_copy(update={"metadata": merged_machine_mode_metadata(request.request.metadata, request.metadata)}))
                payload = {"attempt": attempt + 1, "result": result.model_dump(mode="json"), "errors": errors}
                await queue.append_result(job_id, payload)
                return [payload]
            except Exception as error:
                errors.append(str(error))
                await queue.fail_one(job_id)
        raise RuntimeError("; ".join(errors) or "Retry loop exhausted.")

    def register(self, queue: JobQueue) -> None:
        queue.register("map", self.map)
        queue.register("self_consistency", self.self_consistency)
        queue.register("chunk_summarize", self.chunk_summarize)
        queue.register("retry_loop", self.retry_loop)
