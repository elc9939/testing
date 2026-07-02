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
    recoverability = run.steps[0].detail["recoverability"]
    assert recoverability["reversible"] is True
    assert recoverability["inverse_operations"][0]["source"].endswith("new-note.txt")


async def test_file_delete_real_records_recoverability_snapshot(tmp_path):
    target = tmp_path / "delete-me.txt"
    target.write_text("recoverable", encoding="utf-8")
    _, storage, engine = make_services(tmp_path)
    macro = storage.upsert_macro(
        MacroDefinition(
            name="Delete",
            dry_run_default=False,
            armed=True,
            actions=[ActionDefinition(type="file.delete", config={"path": str(target)})],
        )
    )

    run = await engine.run_macro(macro.id, RunRequest(dry_run=False))

    assert run.status == "succeeded"
    assert not target.exists()
    recoverability = run.steps[0].detail["recoverability"]
    snapshot = recoverability["snapshots"][0]
    assert recoverability["kind"] == "snapshot"
    assert recoverability["reversible"] is True
    assert snapshot["target"] == str(target.resolve())
    assert Path(snapshot["snapshot_path"]).read_text(encoding="utf-8") == "recoverable"
    stored = storage.list_runs(1)[0]["steps"][0]["detail"]["recoverability"]
    assert stored["snapshots"][0]["id"] == snapshot["id"]


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


def test_bridge_token_protects_macro_lab_work_routes_when_configured(tmp_path):
    settings = Settings(data_dir=tmp_path, clipboard_poll_interval_s=60, bridge_token="bridge-secret")
    storage = MacroStorage(settings.database_path())
    app = create_app(settings=settings, storage=storage)

    with TestClient(app) as client:
        health = client.get("/api/macro-lab/health")
        blocked = client.get("/api/macro-lab/macros")
        allowed = client.get("/api/macro-lab/macros", headers={"X-Mini-Hub-Bridge-Token": "bridge-secret"})

    assert health.status_code == 200
    assert health.json()["bridge_auth"] == {"required": True, "accepted": False}
    assert blocked.status_code == 401
    assert allowed.status_code == 200


def test_api_restores_macro_file_recovery_artifacts(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", clipboard_poll_interval_s=60)
    storage = MacroStorage(settings.database_path())
    target = tmp_path / "restore-me.txt"
    target.write_text("before delete", encoding="utf-8")
    macro = storage.upsert_macro(
        MacroDefinition(
            name="Delete then restore",
            dry_run_default=False,
            armed=True,
            actions=[ActionDefinition(type="file.delete", config={"path": str(target)})],
        )
    )
    app = create_app(settings=settings, storage=storage)

    with TestClient(app) as client:
        run = client.post(f"/api/macro-lab/macros/{macro.id}/run", json={"dry_run": False})
        run_id = run.json()["run"]["id"]
        blocked = client.post(f"/api/macro-lab/runs/{run_id}/restore", json={})
        restored = client.post(f"/api/macro-lab/runs/{run_id}/restore", json={"confirm": True})
        runs = client.get("/api/macro-lab/runs?limit=5").json()["runs"]

    assert run.status_code == 200
    assert blocked.status_code == 409
    assert restored.status_code == 200
    assert target.read_text(encoding="utf-8") == "before delete"
    restore_body = restored.json()["restore"]
    assert restore_body["restored_run_id"] == run_id
    assert restore_body["applied"][0]["operation"] == "restore_snapshot"
    restore_runs = [item for item in runs if item["macro_name"] == "Restore Delete then restore"]
    assert {item["status"] for item in restore_runs} == {"failed", "succeeded"}
