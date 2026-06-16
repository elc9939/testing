from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from .config import Settings
from .inference import InferenceRouter
from .models import ChatMessage, DesignPatchRecord, DesignPatchRequest, InferenceRequest, now_iso
from .storage import AppStorage


PATCH_PATH_RE = re.compile(r"^(?:---|\+\+\+)\s+(?P<path>\S+)")


def strip_patch_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _normalize_patch_path(path: str) -> str | None:
    if path == "/dev/null":
        return None
    if path.startswith("a/") or path.startswith("b/"):
        path = path[2:]
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"Patch path is not allowed: {path}")
    normalized = candidate.as_posix()
    if not normalized:
        raise ValueError("Patch contains an empty path.")
    return normalized


def extract_patch_paths(patch: str, target_files: list[str]) -> list[str]:
    paths: set[str] = set()
    for line in patch.splitlines():
        match = PATCH_PATH_RE.match(line)
        if not match:
            continue
        normalized = _normalize_patch_path(match.group("path"))
        if normalized:
            paths.add(normalized)
    for target in target_files:
        normalized = _normalize_patch_path(target)
        if normalized:
            paths.add(normalized)
    return sorted(paths)


def validate_design_patch(settings: Settings, patch: str, target_files: list[str]) -> list[str]:
    if not patch.strip():
        raise ValueError("Patch is empty.")
    if not ("--- " in patch and "+++ " in patch and "@@" in patch):
        raise ValueError("Design patch must be a unified diff.")
    paths = extract_patch_paths(patch, target_files)
    if not paths:
        raise ValueError("Patch does not contain any target files.")
    allowed = {extension.lower() for extension in settings.design_allowed_extensions}
    for path in paths:
        suffix = Path(path).suffix.lower()
        if suffix not in allowed:
            raise ValueError(f"Patch target extension is not allowed: {path}")
    return paths


async def propose_design_patch(
    settings: Settings,
    router: InferenceRouter,
    storage: AppStorage,
    request: DesignPatchRequest,
) -> DesignPatchRecord:
    patch = request.patch
    metadata: dict[str, Any] = {"generated": False}
    if not patch:
        target_hint = "\n".join(f"- {target}" for target in request.target_files) or "- infer likely files from the instruction"
        result = await router.infer(
            InferenceRequest(
                task_type="design.patch",
                provider=request.provider,
                model=request.model,
                local_first=False,
                allow_fallback=True,
                temperature=0.1,
                max_tokens=4096,
                messages=[
                    ChatMessage(
                        role="system",
                        content=(
                            "You generate minimal unified diffs for a local app repository. "
                            "Return only a git-apply-compatible unified diff. Do not include prose, markdown, or shell commands. "
                            "Prefer small reversible UI/style edits and never include secrets."
                        ),
                    ),
                    ChatMessage(
                        role="user",
                        content=(
                            f"Instruction:\n{request.instruction}\n\n"
                            f"Candidate target files:\n{target_hint}\n\n"
                            "Create the smallest useful patch."
                        ),
                    ),
                ],
            )
        )
        patch = strip_patch_fences(result.text)
        metadata = {"generated": True, "provider": result.provider, "model": result.model, "usage_id": result.id}
    paths = validate_design_patch(settings, patch, request.target_files)
    return storage.create_design_patch(
        instruction=request.instruction,
        target_files=paths,
        patch=patch,
        metadata=metadata,
    )


def apply_stored_patch(settings: Settings, storage: AppStorage, patch_id: str, *, confirm: bool, reverse: bool = False) -> DesignPatchRecord:
    if not confirm:
        raise PermissionError("confirm=true is required before applying or reverting a design patch.")
    if not settings.design_apply_enabled:
        raise PermissionError("Design patch application is disabled by AI_OS_DESIGN_APPLY_ENABLED.")

    record = storage.get_design_patch(patch_id)
    if not record:
        raise KeyError(patch_id)

    validate_design_patch(settings, record.patch, record.target_files)
    root = settings.resolved_design_workspace_root()
    if not root.exists():
        raise FileNotFoundError(f"Design workspace root does not exist: {root}")

    patch_dir = settings.resolved_design_patches_dir()
    patch_dir.mkdir(parents=True, exist_ok=True)
    patch_path = patch_dir / f"{record.id}.patch"
    patch_path.write_text(record.patch, encoding="utf-8")

    base_command = ["git", "apply", "--whitespace=nowarn"]
    if reverse:
        base_command.append("-R")
    check_command = [*base_command, "--check", str(patch_path)]
    apply_command = [*base_command, str(patch_path)]

    check = subprocess.run(check_command, cwd=root, capture_output=True, text=True, timeout=20, check=False)
    if check.returncode != 0:
        message = (check.stderr or check.stdout or "git apply --check failed").strip()
        return storage.update_design_patch_status(record.id, status="failed", error=message)

    applied = subprocess.run(apply_command, cwd=root, capture_output=True, text=True, timeout=20, check=False)
    if applied.returncode != 0:
        message = (applied.stderr or applied.stdout or "git apply failed").strip()
        return storage.update_design_patch_status(record.id, status="failed", error=message)

    if reverse:
        return storage.update_design_patch_status(record.id, status="reverted", error=None, reverted_at=now_iso())
    return storage.update_design_patch_status(record.id, status="applied", error=None, applied_at=now_iso())
