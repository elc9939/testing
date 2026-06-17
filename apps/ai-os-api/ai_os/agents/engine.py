from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel

from ..config import Settings
from ..inference import InferenceRouter
from ..memory.store import SemanticMemory
from ..models import AgentRunRequest, AgentRunResult, AgentStep, ChatMessage, InferenceRequest
from ..storage import AppStorage

ToolHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class ToolSpec(BaseModel):
    id: str
    label: str
    description: str
    input_schema: dict[str, Any]
    safety: Literal["read", "write", "destructive"] = "read"
    requires_confirmation: bool = False


class ToolRegistry:
    def __init__(self, storage: AppStorage | None = None) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._handlers: dict[str, ToolHandler] = {}
        self._storage = storage

    def register(self, spec: ToolSpec, handler: ToolHandler) -> None:
        self._specs[spec.id] = spec
        self._handlers[spec.id] = handler

    def specs(self) -> list[ToolSpec]:
        return list(self._specs.values())

    async def call(self, tool_id: str, payload: dict[str, Any], *, confirmed: bool = False, run_id: str | None = None) -> dict[str, Any]:
        if tool_id not in self._handlers:
            raise KeyError(tool_id)
        spec = self._specs[tool_id]
        started = time.perf_counter()
        if spec.requires_confirmation and not confirmed:
            result = {
                "ok": False,
                "requires_confirmation": True,
                "tool_id": tool_id,
                "safety": spec.safety,
                "message": "This tool can write to apps or control the machine. Re-run with confirm_actions=true to execute.",
            }
            self._log_tool(spec, payload, result, None, started, run_id)
            return result
        try:
            result = await self._handlers[tool_id](payload)
            self._log_tool(spec, payload, result, None, started, run_id)
            return result
        except Exception as error:
            result = {"ok": False, "error": str(error), "tool_id": tool_id}
            self._log_tool(spec, payload, result, str(error), started, run_id)
            raise

    def _log_tool(
        self,
        spec: ToolSpec,
        payload: dict[str, Any],
        result: dict[str, Any],
        error: str | None,
        started: float,
        run_id: str | None,
    ) -> None:
        if not self._storage:
            return
        self._storage.log_tool_call(
            tool_id=spec.id,
            ok=bool(result.get("ok")) and not error,
            safety=spec.safety,
            requires_confirmation=spec.requires_confirmation,
            arguments=payload,
            result=result,
            error=error,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            run_id=run_id,
        )


class AgentEngine:
    def __init__(self, router: InferenceRouter, tools: ToolRegistry):
        self.router = router
        self.tools = tools

    def _system_prompt(self, request: AgentRunRequest) -> str:
        tool_specs = [tool.model_dump() for tool in self.tools.specs() if not request.tools or tool.id in request.tools]
        return (
            "You are a generic AI OS execution engine. Do not invent app-specific goals. "
            "Some tools are write/destructive and require confirmation. If a tool returns requires_confirmation, "
            "stop and explain the exact confirmation needed instead of trying to bypass it. "
            "For each step, respond with concise JSON using keys plan, tool_calls, done, output. "
            "tool_calls is an array of {tool_id, arguments}. Available tools: "
            + json.dumps(tool_specs)
        )

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        run_id = request.context.get("run_id") if isinstance(request.context.get("run_id"), str) else None
        confirmed = bool(request.context.get("confirmed") or request.context.get("confirm_actions"))
        transcript = f"Objective: {request.objective}\nContext: {json.dumps(request.context)}"
        steps: list[AgentStep] = []
        output = ""
        for index in range(request.max_steps):
            plan_request = InferenceRequest(
                task_type="agent.plan",
                provider=request.provider,
                model=request.model,
                temperature=0.1,
                max_tokens=700,
                messages=[
                    ChatMessage(role="system", content=self._system_prompt(request)),
                    ChatMessage(role="user", content=transcript),
                ],
            )
            plan = await self.router.infer(plan_request)
            tool_calls: list[dict[str, Any]] = []
            observations: list[dict[str, Any]] = []
            done = False
            try:
                parsed = json.loads(plan.text)
                tool_calls = list(parsed.get("tool_calls") or [])
                done = bool(parsed.get("done"))
                output = str(parsed.get("output") or output)
            except Exception:
                parsed = {"plan": plan.text, "tool_calls": [], "done": False, "output": ""}
            steps.append(AgentStep(index=index, phase="plan", text=str(parsed.get("plan") or plan.text), tool_calls=tool_calls))
            for call in tool_calls:
                tool_id = str(call.get("tool_id") or "")
                arguments = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
                try:
                    observation = await self.tools.call(tool_id, arguments, confirmed=confirmed, run_id=run_id)
                except Exception as error:
                    observation = {"ok": False, "error": str(error), "tool_id": tool_id}
                observations.append(observation)
            if observations:
                steps.append(AgentStep(index=index, phase="act", text="Executed tool calls.", observations=observations))
                transcript += f"\nStep {index + 1} observations: {json.dumps(observations)}"
            if done:
                steps.append(AgentStep(index=index, phase="check", text="Agent marked objective complete."))
                return AgentRunResult(agent_id=request.agent_id, status="succeeded", objective=request.objective, steps=steps, output=output)
            transcript += f"\nStep {index + 1} plan: {plan.text}"
        return AgentRunResult(agent_id=request.agent_id, status="needs_more_steps", objective=request.objective, steps=steps, output=output)


def build_tool_registry(
    router: InferenceRouter,
    memory: SemanticMemory,
    settings: Settings | None = None,
    storage: AppStorage | None = None,
) -> ToolRegistry:
    registry = ToolRegistry(storage)

    def hub_headers() -> dict[str, str]:
        return {"content-type": "application/json"}

    def require_settings() -> Settings:
        if not settings:
            raise RuntimeError("AI OS app-action settings were not configured.")
        return settings

    async def get_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
        import httpx

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()

    async def post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        import httpx

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    async def infer_tool(payload: dict[str, Any]) -> dict[str, Any]:
        result = await router.infer(InferenceRequest(prompt=str(payload.get("prompt") or ""), task_type="agent.tool.infer"))
        return {"ok": True, "result": result.model_dump(mode="json")}

    async def memory_tool(payload: dict[str, Any]) -> dict[str, Any]:
        from ..models import MemoryQueryRequest

        hits = await memory.query(MemoryQueryRequest(query=str(payload.get("query") or ""), limit=int(payload.get("limit") or 5)))
        return {"ok": True, "hits": [hit.model_dump(mode="json") for hit in hits]}

    async def hub_status_tool(_: dict[str, Any]) -> dict[str, Any]:
        configured = require_settings()
        health = await get_json(f"{configured.hub_api_url.rstrip('/')}/api/health", headers=hub_headers())
        settings_result = await get_json(f"{configured.hub_api_url.rstrip('/')}/api/settings", headers=hub_headers())
        return {"ok": True, "health": health, "settings": settings_result}

    async def study_add_tool(payload: dict[str, Any]) -> dict[str, Any]:
        configured = require_settings()
        body = {
            "workspaceId": configured.hub_workspace_id,
            "subject": str(payload.get("subject") or payload.get("title") or "AI OS session"),
            "minutes": int(payload.get("minutes") or 0),
            "source": str(payload.get("source") or "ai-command"),
        }
        return {"ok": True, "response": await post_json(f"{configured.hub_api_url.rstrip('/')}/api/study", body, hub_headers())}

    async def career_job_add_tool(payload: dict[str, Any]) -> dict[str, Any]:
        configured = require_settings()
        body = {
            "workspaceId": configured.hub_workspace_id,
            "company": str(payload.get("company") or "Unknown"),
            "role": str(payload.get("role") or "Opportunity"),
            "status": str(payload.get("status") or "lead"),
            "notes": str(payload.get("notes") or ""),
            "nextActionAt": payload.get("nextActionAt"),
        }
        return {"ok": True, "response": await post_json(f"{configured.hub_api_url.rstrip('/')}/api/jobs", body, hub_headers())}

    async def macro_list_tool(_: dict[str, Any]) -> dict[str, Any]:
        configured = require_settings()
        response = await get_json(f"{configured.macro_lab_api_url.rstrip('/')}/api/macro-lab/macros")
        return {"ok": True, "macros": response.get("macros", [])}

    async def macro_run_tool(payload: dict[str, Any]) -> dict[str, Any]:
        configured = require_settings()
        macro_id = str(payload.get("macro_id") or payload.get("id") or "")
        if not macro_id:
            raise ValueError("macro_id is required.")
        body = {
            "dry_run": bool(payload.get("dry_run", False)),
            "confirm": True,
            "variables": payload.get("variables") if isinstance(payload.get("variables"), dict) else {},
        }
        response = await post_json(f"{configured.macro_lab_api_url.rstrip('/')}/api/macro-lab/macros/{macro_id}/run", body)
        return {"ok": True, "response": response}

    registry.register(
        ToolSpec(
            id="ai.infer",
            label="Inference",
            description="Run one routed inference call through the AI OS router.",
            input_schema={"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
            safety="read",
        ),
        infer_tool,
    )
    registry.register(
        ToolSpec(
            id="memory.search",
            label="Semantic memory search",
            description="Search local semantic memory.",
            input_schema={
                "type": "object",
                "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
                "required": ["query"],
            },
            safety="read",
        ),
        memory_tool,
    )
    registry.register(
        ToolSpec(
            id="hub.status",
            label="Hub status",
            description="Read Mini Hub health and personal settings through the real Hub API.",
            input_schema={"type": "object", "properties": {}},
            safety="read",
        ),
        hub_status_tool,
    )
    registry.register(
        ToolSpec(
            id="study.add_session",
            label="Add study session",
            description="Create a Study Desk session in the personal workspace through the real Hub API.",
            input_schema={
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "minutes": {"type": "integer", "minimum": 0},
                    "source": {"type": "string"},
                },
                "required": ["subject", "minutes"],
            },
            safety="write",
            requires_confirmation=True,
        ),
        study_add_tool,
    )
    registry.register(
        ToolSpec(
            id="career.add_job",
            label="Add career job",
            description="Create a Career Desk job/opportunity through the real Hub API.",
            input_schema={
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "status": {"type": "string"},
                    "notes": {"type": "string"},
                    "nextActionAt": {"type": ["string", "null"]},
                },
                "required": ["company", "role"],
            },
            safety="write",
            requires_confirmation=True,
        ),
        career_job_add_tool,
    )
    registry.register(
        ToolSpec(
            id="macro.list",
            label="List macros",
            description="Read available Macro Lab macros from the real Macro Lab daemon.",
            input_schema={"type": "object", "properties": {}},
            safety="read",
        ),
        macro_list_tool,
    )
    registry.register(
        ToolSpec(
            id="macro.run",
            label="Run macro",
            description="Run a Macro Lab macro on this Windows machine.",
            input_schema={
                "type": "object",
                "properties": {
                    "macro_id": {"type": "string"},
                    "dry_run": {"type": "boolean"},
                    "variables": {"type": "object"},
                },
                "required": ["macro_id"],
            },
            safety="destructive",
            requires_confirmation=True,
        ),
        macro_run_tool,
    )
    return registry
