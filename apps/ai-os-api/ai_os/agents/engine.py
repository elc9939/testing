from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel

from ..inference import InferenceRouter
from ..memory.store import SemanticMemory
from ..models import AgentRunRequest, AgentRunResult, AgentStep, ChatMessage, InferenceRequest

ToolHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class ToolSpec(BaseModel):
    id: str
    label: str
    description: str
    input_schema: dict[str, Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._handlers: dict[str, ToolHandler] = {}

    def register(self, spec: ToolSpec, handler: ToolHandler) -> None:
        self._specs[spec.id] = spec
        self._handlers[spec.id] = handler

    def specs(self) -> list[ToolSpec]:
        return list(self._specs.values())

    async def call(self, tool_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if tool_id not in self._handlers:
            raise KeyError(tool_id)
        return await self._handlers[tool_id](payload)


class AgentEngine:
    def __init__(self, router: InferenceRouter, tools: ToolRegistry):
        self.router = router
        self.tools = tools

    def _system_prompt(self, request: AgentRunRequest) -> str:
        tool_specs = [tool.model_dump() for tool in self.tools.specs() if not request.tools or tool.id in request.tools]
        return (
            "You are a generic AI OS execution engine. Do not invent app-specific goals. "
            "For each step, respond with concise JSON using keys plan, tool_calls, done, output. "
            "tool_calls is an array of {tool_id, arguments}. Available tools: "
            + json.dumps(tool_specs)
        )

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
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
                    observation = await self.tools.call(tool_id, arguments)
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


def build_tool_registry(router: InferenceRouter, memory: SemanticMemory) -> ToolRegistry:
    registry = ToolRegistry()

    async def infer_tool(payload: dict[str, Any]) -> dict[str, Any]:
        result = await router.infer(InferenceRequest(prompt=str(payload.get("prompt") or ""), task_type="agent.tool.infer"))
        return {"ok": True, "result": result.model_dump(mode="json")}

    async def memory_tool(payload: dict[str, Any]) -> dict[str, Any]:
        from ..models import MemoryQueryRequest

        hits = await memory.query(MemoryQueryRequest(query=str(payload.get("query") or ""), limit=int(payload.get("limit") or 5)))
        return {"ok": True, "hits": [hit.model_dump(mode="json") for hit in hits]}

    registry.register(
        ToolSpec(
            id="ai.infer",
            label="Inference",
            description="Run one routed inference call through the AI OS router.",
            input_schema={"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
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
        ),
        memory_tool,
    )
    return registry
