from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from macro_lab.actions import build_action_registry
from macro_lab.app import create_app
from macro_lab.config import Settings
from macro_lab.engine import MacroEngine
from macro_lab.models import ActionDefinition, MacroDefinition, RunRequest
from macro_lab.storage import MacroStorage


def make_services(tmp_path: Path):
    settings = Settings(data_dir=tmp_path, clipboard_poll_interval_s=60)
    storage = MacroStorage(settings.database_path())
    engine = MacroEngine(settings, storage, build_action_registry())
    return settings, storage, engine


def test_storage_seeds_and_integrity(tmp_path):
    settings = Settings(data_dir=tmp_path)
    storage = MacroStorage(settings.database_path())

    report = storage.integrity_report()

    assert report["ok"] is True
    assert report["schema_version"] == 1


async def test_dry_run_shell_macro_records_steps(tmp_path):
    _, storage, engine = make_services(tmp_path)
    macro = storage.upsert_macro(
        MacroDefinition(
            name="Dry shell",
            dry_run_default=True,
            actions=[ActionDefinition(type="shell.run", config={"command": "echo hello"})],
        )
    )

    run = await engine.run_macro(macro.id, RunRequest(dry_run=True))

    assert run.status == "dry_run"
    assert run.steps[0].status == "dry_run"
    assert "Would run shell command" in run.steps[0].detail["message"]
    assert storage.list_runs(1)[0]["id"] == run.id


async def test_armed_gate_blocks_side_effect_without_confirmation(tmp_path):
    _, storage, engine = make_services(tmp_path)
    macro = storage.upsert_macro(
        MacroDefinition(
            name="Unsafe shell",
            dry_run_default=False,
            armed=False,
            actions=[ActionDefinition(type="shell.run", config={"command": "echo hello"})],
        )
    )

    run = await engine.run_macro(macro.id, RunRequest(dry_run=False))

    assert run.status == "failed"
    assert "arm the macro" in (run.error or "")


async def test_file_batch_rename_real_when_armed(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    source = work / "old-note.txt"
    source.write_text("hello", encoding="utf-8")
    _, storage, engine = make_services(tmp_path)
    macro = storage.upsert_macro(
        MacroDefinition(
            name="Rename",
            dry_run_default=False,
            armed=True,
            actions=[
                ActionDefinition(
                    type="file.batch_rename",
                    config={"directory": str(work), "pattern": "*.txt", "find": "old", "replace": "new"},
                )
            ],
        )
    )

    run = await engine.run_macro(macro.id, RunRequest(dry_run=False))

    assert run.status == "succeeded"
    assert not source.exists()
    assert (work / "new-note.txt").exists()


def test_api_macro_run_and_panic(tmp_path):
    settings = Settings(data_dir=tmp_path, clipboard_poll_interval_s=60)
    storage = MacroStorage(settings.database_path())
    macro = storage.upsert_macro(
        MacroDefinition(
            name="API dry",
            dry_run_default=True,
            actions=[ActionDefinition(type="shell.run", config={"command": "echo hi"})],
        )
    )
    app = create_app(settings=settings, storage=storage)

    with TestClient(app) as client:
        macros = client.get("/api/macro-lab/macros")
        run = client.post(f"/api/macro-lab/macros/{macro.id}/run", json={"dry_run": True})
        panic = client.post("/api/macro-lab/panic")
        status = client.get("/api/macro-lab/status")
        reset = client.post("/api/macro-lab/panic/reset")

    assert macros.status_code == 200
    assert run.json()["run"]["status"] == "dry_run"
    assert panic.json()["panic"] is True
    assert status.json()["engine"]["panic"] is True
    assert reset.json()["panic"] is False
