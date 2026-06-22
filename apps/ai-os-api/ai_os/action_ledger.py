from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from .models import (
    ActionLedgerEntry,
    ActionRecoverability,
    BenchmarkRunRecord,
    DesignPatchRecord,
    GenerationAssetRecord,
    JobSnapshot,
    MachineProfileSnapshotRecord,
    ResearchRunRecord,
    ToolCallLogEntry,
    UsageLogEntry,
)
from .storage import AppStorage


def _date_value(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _title_case(value: str) -> str:
    return value.replace("_", " ").replace("-", " ").title()


def _find_machine_mode(payload: Any, depth: int = 0) -> str | None:
    if depth > 5:
        return None
    if isinstance(payload, dict):
        machine_mode = payload.get("machine_mode")
        if isinstance(machine_mode, dict):
            mode_id = machine_mode.get("id")
            if isinstance(mode_id, str) and mode_id.strip():
                return mode_id
        if isinstance(machine_mode, str) and machine_mode.strip():
            return machine_mode
        for value in payload.values():
            found = _find_machine_mode(value, depth + 1)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _find_machine_mode(value, depth + 1)
            if found:
                return found
    return None


def _status_from_job(status: str) -> str:
    if status in {"queued", "running", "succeeded", "failed", "cancelled"}:
        return status
    return "info"


def _format_ms(value: float | int | None) -> str:
    if value is None:
        return "unknown latency"
    return f"{round(float(value))} ms"


def _tool_entry(call: ToolCallLogEntry) -> ActionLedgerEntry:
    status = "succeeded" if call.ok else "failed"
    result = call.result if isinstance(call.result, dict) else {}
    if not call.ok and call.requires_confirmation and result.get("requires_confirmation"):
        status = "blocked"
    risk = "destructive" if call.safety == "destructive" else call.safety
    detail = call.error or f"{call.safety} tool completed in {_format_ms(call.latency_ms)}"
    recoverability = _recoverability_from_tool(call, status)
    return ActionLedgerEntry(
        id=f"ai-tool:{call.id}",
        occurred_at=call.created_at,
        system="ai-os",
        source="tool_call",
        action_type=call.tool_id,
        summary=f"Tool {call.tool_id} {status.replace('_', ' ')}",
        status=status,  # type: ignore[arg-type]
        risk=risk,  # type: ignore[arg-type]
        mode=_find_machine_mode({"arguments": call.arguments, "result": call.result}),
        changed=_changed_from_tool(call),
        recoverability=recoverability,
        raw_ref={"kind": "tool_call", "id": call.id, "tool_id": call.tool_id, "run_id": call.run_id},
        metadata={
            "requires_confirmation": call.requires_confirmation,
            "latency_ms": call.latency_ms,
            "detail": detail,
            "pre_action_snapshot": _pre_action_snapshot(call),
        },
    )


def _pre_action_snapshot(call: ToolCallLogEntry) -> dict[str, Any] | None:
    result = call.result if isinstance(call.result, dict) else {}
    snapshot = result.get("pre_action_snapshot")
    return snapshot if isinstance(snapshot, dict) else None


def _recoverability_from_tool(call: ToolCallLogEntry, status: str) -> ActionRecoverability:
    snapshot = _pre_action_snapshot(call)
    if snapshot:
        existed = bool(snapshot.get("existed"))
        snapshot_id = str(snapshot.get("id") or "")
        target = str(snapshot.get("target") or "").strip()
        if existed:
            description = "Pre-action file snapshot captured before this tool wrote to disk."
        else:
            description = "Pre-action snapshot recorded that this target did not exist before the tool wrote to disk."
        if target:
            description = f"{description} Target: {target}"
        return ActionRecoverability(
            kind="snapshot",
            reference_id=snapshot_id or None,
            route="/ai-os",
            description=description,
            reversible=existed and bool(snapshot.get("snapshot_path")),
        )
    return ActionRecoverability(
        kind="none",
        description=(
            "Confirmation gate blocked this tool before side effects."
            if status == "blocked"
            else "Tool call log is recorded, but no automatic rollback artifact is attached."
        ),
        reversible=status == "blocked",
    )


def _changed_from_tool(call: ToolCallLogEntry) -> list[str]:
    result = call.result if isinstance(call.result, dict) else {}
    changed: list[str] = []
    for key in ("desktop_path", "asset_path", "path", "file", "target"):
        value = result.get(key)
        if isinstance(value, str) and value:
            changed.append(value)
    if not changed and call.safety in {"write", "destructive"}:
        changed.append(call.tool_id)
    return changed


def _benchmark_entry(run: BenchmarkRunRecord) -> ActionLedgerEntry:
    provider = "/".join([part for part in [run.provider, run.model] if part])
    speed = f", {run.tokens_per_second:.1f} tokens/sec" if isinstance(run.tokens_per_second, (int, float)) else ""
    return ActionLedgerEntry(
        id=f"ai-benchmark:{run.id}",
        occurred_at=run.created_at,
        system="ai-os",
        source="benchmark",
        action_type=f"benchmark.{run.kind}",
        summary=f"{_title_case(run.kind)} benchmark {'passed' if run.ok else 'failed'}",
        status="succeeded" if run.ok else "failed",
        risk="read",
        mode=_find_machine_mode(run.result),
        changed=[f"benchmark:{run.id}"],
        recoverability=ActionRecoverability(
            kind="snapshot",
            reference_id=run.id,
            route="/ai-os",
            description="Benchmark result is persisted as a measurement snapshot.",
            reversible=False,
        ),
        raw_ref={"kind": "benchmark_run", "id": run.id},
        metadata={
            "provider": run.provider,
            "model": run.model,
            "latency_ms": run.latency_ms,
            "tokens_per_second": run.tokens_per_second,
            "detail": run.error or f"{provider or 'auto route'} completed in {_format_ms(run.latency_ms)}{speed}.",
        },
    )


def _backup_entry(backup: dict[str, Any]) -> ActionLedgerEntry:
    backup_id = str(backup.get("id") or "")
    ok = backup.get("ok") is True
    return ActionLedgerEntry(
        id=f"ai-backup:{backup_id}",
        occurred_at=str(backup.get("created_at") or ""),
        system="ai-os",
        source="backup",
        action_type="backup.create",
        summary=f"Backup {backup.get('reason') or 'manual'} {'created' if ok else 'failed'}",
        status="succeeded" if ok else "failed",
        risk="system",
        changed=["ai-os.sqlite3", "assets"],
        recoverability=ActionRecoverability(
            kind="backup",
            reference_id=backup_id,
            route="/ai-os",
            description="Backup can be verified and restore-tested from AI OS maintenance.",
            reversible=ok,
        ),
        raw_ref={"kind": "backup", "id": backup_id, "path": backup.get("path")},
        metadata={
            "size_bytes": backup.get("size_bytes"),
            "error": backup.get("error"),
        },
    )


def _machine_profile_entry(snapshot: MachineProfileSnapshotRecord) -> ActionLedgerEntry:
    source = snapshot.source or "manual"
    is_autotune = source.startswith("autotune:")
    ok = snapshot.autotune.get("ok")
    status = "succeeded" if ok is not False else "failed"
    return ActionLedgerEntry(
        id=f"ai-machine-profile:{snapshot.id}",
        occurred_at=snapshot.created_at,
        system="ai-os",
        source="machine_profile",
        action_type="autotune.run" if is_autotune else "machine_profile.snapshot",
        summary=f"{'Autotune' if is_autotune else 'Machine profile snapshot'} recorded",
        status=status,
        risk="system" if is_autotune else "read",
        mode=str(snapshot.autotune.get("mode") or _find_machine_mode(snapshot.profile) or "").strip() or None,
        changed=["machine_profile"],
        recoverability=ActionRecoverability(
            kind="snapshot",
            reference_id=snapshot.id,
            route="/ai-os",
            description="Machine profile snapshot records observed hardware, provider, and readiness state.",
            reversible=False,
        ),
        raw_ref={"kind": "machine_profile_snapshot", "id": snapshot.id, "source": source},
        metadata={"autotune": snapshot.autotune},
    )


def _generation_entry(asset: GenerationAssetRecord) -> ActionLedgerEntry:
    changed = [value for value in [asset.asset_path, f"asset:{asset.id}"] if value]
    provider = "/".join([part for part in [asset.provider, asset.model] if part])
    return ActionLedgerEntry(
        id=f"ai-generation:{asset.id}",
        occurred_at=asset.created_at,
        system="ai-os",
        source="generation_asset",
        action_type=f"generation.{asset.kind}",
        summary=f"Generated {_title_case(asset.kind)} artifact",
        status="succeeded",
        risk="write",
        mode=_find_machine_mode(asset.metadata),
        changed=changed,
        recoverability=ActionRecoverability(
            kind="artifact",
            reference_id=asset.id,
            route="/ai-os",
            description="Generated artifact is tracked in the AI OS gallery/log.",
            reversible=bool(asset.asset_path),
        ),
        raw_ref={"kind": "generation_asset", "id": asset.id},
        metadata={
            "provider": asset.provider,
            "model": asset.model,
            "content_type": asset.content_type,
            "detail": provider or asset.content_type or "generation adapter",
        },
    )


def _design_patch_entry(patch: DesignPatchRecord) -> ActionLedgerEntry:
    occurred_at = patch.reverted_at or patch.applied_at or patch.created_at
    status_map = {
        "proposed": "info",
        "applied": "succeeded",
        "reverted": "succeeded",
        "failed": "failed",
    }
    return ActionLedgerEntry(
        id=f"ai-design-patch:{patch.id}",
        occurred_at=occurred_at,
        system="ai-os",
        source="design_patch",
        action_type=f"design_patch.{patch.status}",
        summary=f"Design patch {patch.status}",
        status=status_map.get(patch.status, "info"),  # type: ignore[arg-type]
        risk="write",
        mode=_find_machine_mode(patch.metadata),
        changed=patch.target_files,
        recoverability=ActionRecoverability(
            kind="patch",
            reference_id=patch.id,
            route="/ai-os",
            description="Stored unified diff can be inspected; applied patches can be reverted through AI OS.",
            reversible=patch.status in {"applied", "proposed"},
        ),
        raw_ref={"kind": "design_patch", "id": patch.id},
        metadata={"instruction": patch.instruction, "error": patch.error},
    )


def _usage_entry(entry: UsageLogEntry) -> ActionLedgerEntry | None:
    if entry.metadata.get("autotune") is True or str(entry.task_type).startswith("benchmark"):
        return None
    route = "/ai-os"
    detail = (
        entry.error
        or f"{entry.provider}/{entry.model} used {entry.total_tokens} tokens in {_format_ms(entry.latency_ms)}"
    )
    return ActionLedgerEntry(
        id=f"ai-inference:{entry.id}",
        occurred_at=entry.created_at,
        system="ai-os",
        source="inference",
        action_type=f"inference.{entry.task_type}",
        summary=f"Inference {entry.task_type} {'completed' if entry.ok else 'failed'}",
        status="succeeded" if entry.ok else "failed",
        risk="read",
        mode=_find_machine_mode(entry.metadata),
        changed=[],
        recoverability=ActionRecoverability(
            kind="none",
            route=route,
            description="Inference usage is logged for audit/cost visibility; it does not mutate app data by itself.",
            reversible=False,
        ),
        raw_ref={"kind": "usage_log", "id": entry.id},
        metadata={
            "provider": entry.provider,
            "model": entry.model,
            "cost_usd": entry.cost_usd,
            "latency_ms": entry.latency_ms,
            "total_tokens": entry.total_tokens,
            "detail": detail,
        },
    )


def _job_entry(job: JobSnapshot) -> ActionLedgerEntry:
    return ActionLedgerEntry(
        id=f"ai-job:{job.id}",
        occurred_at=job.updated_at or job.created_at,
        system="ai-os",
        source="job_queue",
        action_type=f"job.{job.primitive}",
        summary=f"{_title_case(job.primitive)} job {job.status}",
        status=_status_from_job(job.status),  # type: ignore[arg-type]
        risk="system",
        mode=_find_machine_mode(job.metadata),
        changed=[f"job:{job.id}"],
        recoverability=ActionRecoverability(
            kind="none",
            route="/ai-os",
            description="Job progress and results are tracked, but no rollback artifact is attached.",
            reversible=False,
        ),
        raw_ref={"kind": "job", "id": job.id},
        metadata={
            "total": job.total,
            "completed": job.completed,
            "failed": job.failed,
            "progress": job.progress,
            "error": job.error,
        },
    )


def _research_entry(run: ResearchRunRecord) -> ActionLedgerEntry:
    status = run.status if run.status in {"queued", "running", "paused", "succeeded", "failed", "cancelled"} else "info"
    provider = "/".join(part for part in [run.provider, run.model] if part)
    research_metadata = run.options.get("metadata") if isinstance(run.options.get("metadata"), dict) else {}
    return ActionLedgerEntry(
        id=f"ai-research:{run.id}",
        occurred_at=run.updated_at or run.created_at,
        system="ai-os",
        source="research",
        action_type=f"research.{run.mode}",
        summary=f"Research {run.mode.replace('_', ' ')} {run.status}",
        status=status,  # type: ignore[arg-type]
        risk="read",
        mode=_find_machine_mode(run.options),
        changed=[f"research:{run.id}", *[f"source:{source.id}" for source in run.sources[:5]]],
        recoverability=ActionRecoverability(
            kind="artifact",
            reference_id=run.id,
            route="/research",
            description="Deep Research Report is archived with sources, citations, logs, and exportable artifacts.",
            reversible=False,
        ),
        raw_ref={"kind": "research_run", "id": run.id},
        metadata={
            "source_count": len(run.sources),
            "cached_pages": run.cached_pages,
            "runtime_ms": run.runtime_ms,
            "progress": run.progress,
            "completed_steps": run.completed_steps,
            "total_steps": run.total_steps,
            "current_step": run.current_step,
            "cancel_requested": run.cancel_requested,
            "memory_document_id": run.memory_document_id,
            "memory_chunks": run.memory_chunks,
            "provider": run.provider,
            "model": run.model,
            "total_tokens": run.total_tokens,
            "cost_usd": run.cost_usd,
            "research_monitor_id": research_metadata.get("research_monitor_id"),
            "research_monitor_name": research_metadata.get("research_monitor_name"),
            "detail": run.error or f"{len(run.sources)} source(s), {round(run.runtime_ms)} ms, {provider or 'extractive'}",
        },
    )


def build_ai_action_ledger(
    *,
    storage: AppStorage,
    backups: Iterable[dict[str, Any]],
    jobs: Iterable[JobSnapshot],
    limit: int = 50,
) -> list[ActionLedgerEntry]:
    read_limit = max(1, min(limit * 3, 200))
    entries: list[ActionLedgerEntry] = []
    entries.extend(_job_entry(job) for job in jobs)
    entries.extend(_tool_entry(call) for call in storage.list_tool_calls(read_limit))
    entries.extend(_benchmark_entry(run) for run in storage.list_benchmarks(read_limit))
    entries.extend(_backup_entry(backup) for backup in backups if backup.get("id") and backup.get("created_at"))
    entries.extend(_machine_profile_entry(snapshot) for snapshot in storage.list_machine_profile_snapshots(read_limit))
    entries.extend(_generation_entry(asset) for asset in storage.list_generation_assets(read_limit))
    entries.extend(_design_patch_entry(patch) for patch in storage.list_design_patches(read_limit))
    entries.extend(_research_entry(run) for run in storage.list_research_runs(read_limit))
    entries.extend(
        usage
        for usage in (_usage_entry(entry) for entry in storage.list_usage(read_limit))
        if usage is not None
    )
    return sorted(
        [entry for entry in entries if entry.occurred_at],
        key=lambda entry: (_date_value(entry.occurred_at), entry.id),
        reverse=True,
    )[: max(1, min(limit, 200))]
