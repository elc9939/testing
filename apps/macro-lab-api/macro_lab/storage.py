from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .models import MacroDefinition, RunRecord, WindowLayoutRecord, now_iso

CURRENT_SCHEMA_VERSION = 1


class MacroStorage:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("pragma foreign_keys = on")
        self._conn.execute("pragma journal_mode = wal")
        self._migrate()

    def close(self) -> None:
        self._conn.close()

    def _migrate(self) -> None:
        self._conn.execute(
            """
            create table if not exists schema_migrations (
              version integer primary key,
              name text not null,
              applied_at text not null
            )
            """
        )
        current = self.schema_version()
        if current < 1:
            self._apply_0001()
        self._conn.commit()

    def _apply_0001(self) -> None:
        self._conn.executescript(
            """
            create table if not exists macros (
              id text primary key,
              name text not null,
              group_name text not null,
              enabled integer not null default 1,
              armed integer not null default 0,
              body_json text not null,
              created_at text not null,
              updated_at text not null
            );
            create index if not exists idx_macros_group on macros(group_name);
            create table if not exists run_history (
              id text primary key,
              macro_id text not null,
              macro_name text not null,
              trigger_id text,
              status text not null,
              dry_run integer not null,
              started_at text not null,
              finished_at text,
              error text,
              steps_json text not null
            );
            create index if not exists idx_run_history_started on run_history(started_at desc);
            create table if not exists clipboard_history (
              id integer primary key autoincrement,
              value text not null,
              created_at text not null
            );
            create index if not exists idx_clipboard_created on clipboard_history(created_at desc);
            create table if not exists window_layouts (
              name text primary key,
              body_json text not null,
              created_at text not null,
              updated_at text not null
            );
            create table if not exists settings (
              key text primary key,
              value_json text not null,
              updated_at text not null
            );
            """
        )
        self._conn.execute(
            "insert into schema_migrations(version, name, applied_at) values (?, ?, ?)",
            (1, "0001_initial_macro_lab_schema", now_iso()),
        )

    def schema_version(self) -> int:
        row = self._conn.execute("select max(version) as version from schema_migrations").fetchone()
        return int(row["version"] or 0) if row else 0

    def integrity_report(self) -> dict[str, Any]:
        integrity = [str(row[0]) for row in self._conn.execute("pragma integrity_check").fetchall()]
        foreign_keys = [dict(row) for row in self._conn.execute("pragma foreign_key_check").fetchall()]
        counts = {
            table: int(self._conn.execute(f"select count(*) as count from {table}").fetchone()["count"])
            for table in ("macros", "run_history", "clipboard_history", "window_layouts", "settings")
        }
        return {
            "ok": integrity == ["ok"] and not foreign_keys and self.schema_version() == CURRENT_SCHEMA_VERSION,
            "schema_version": self.schema_version(),
            "expected_schema_version": CURRENT_SCHEMA_VERSION,
            "integrity": integrity,
            "foreign_key_errors": foreign_keys,
            "counts": counts,
            "database_path": str(self.db_path),
        }

    def list_macros(self) -> list[MacroDefinition]:
        rows = self._conn.execute("select body_json from macros order by group_name, name").fetchall()
        return [MacroDefinition.model_validate_json(row["body_json"]) for row in rows]

    def get_macro(self, macro_id: str) -> MacroDefinition | None:
        row = self._conn.execute("select body_json from macros where id = ?", (macro_id,)).fetchone()
        return MacroDefinition.model_validate_json(row["body_json"]) if row else None

    def upsert_macro(self, macro: MacroDefinition) -> MacroDefinition:
        macro.updated_at = now_iso()
        body = macro.model_dump_json()
        self._conn.execute(
            """
            insert into macros(id, name, group_name, enabled, armed, body_json, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              group_name = excluded.group_name,
              enabled = excluded.enabled,
              armed = excluded.armed,
              body_json = excluded.body_json,
              updated_at = excluded.updated_at
            """,
            (macro.id, macro.name, macro.group, int(macro.enabled), int(macro.armed), body, macro.created_at, macro.updated_at),
        )
        self._conn.commit()
        return macro

    def delete_macro(self, macro_id: str) -> bool:
        cursor = self._conn.execute("delete from macros where id = ?", (macro_id,))
        self._conn.commit()
        return cursor.rowcount > 0

    def append_run(self, run: RunRecord, limit: int = 500) -> None:
        self._conn.execute(
            """
            insert or replace into run_history(id, macro_id, macro_name, trigger_id, status, dry_run, started_at, finished_at, error, steps_json)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run.id,
                run.macro_id,
                run.macro_name,
                run.trigger_id,
                run.status,
                int(run.dry_run),
                run.started_at,
                run.finished_at,
                run.error,
                json.dumps([step.model_dump(mode="json") for step in run.steps]),
            ),
        )
        self._conn.execute(
            "delete from run_history where id not in (select id from run_history order by started_at desc limit ?)",
            (limit,),
        )
        self._conn.commit()

    def list_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "select * from run_history order by started_at desc limit ?",
            (limit,),
        ).fetchall()
        return [
            {
                "id": row["id"],
                "macro_id": row["macro_id"],
                "macro_name": row["macro_name"],
                "trigger_id": row["trigger_id"],
                "status": row["status"],
                "dry_run": bool(row["dry_run"]),
                "started_at": row["started_at"],
                "finished_at": row["finished_at"],
                "error": row["error"],
                "steps": json.loads(row["steps_json"]),
            }
            for row in rows
        ]

    def add_clipboard(self, value: str, limit: int = 100) -> None:
        if not value:
            return
        latest = self._conn.execute("select value from clipboard_history order by created_at desc limit 1").fetchone()
        if latest and latest["value"] == value:
            return
        self._conn.execute(
            "insert into clipboard_history(value, created_at) values (?, ?)",
            (value, now_iso()),
        )
        self._conn.execute(
            "delete from clipboard_history where id not in (select id from clipboard_history order by created_at desc limit ?)",
            (limit,),
        )
        self._conn.commit()

    def list_clipboard(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "select id, value, created_at from clipboard_history order by created_at desc limit ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def save_layout(self, layout: WindowLayoutRecord) -> WindowLayoutRecord:
        existing = self.get_layout(layout.name)
        if existing:
            layout.created_at = existing.created_at
        layout.updated_at = now_iso()
        self._conn.execute(
            """
            insert into window_layouts(name, body_json, created_at, updated_at)
            values (?, ?, ?, ?)
            on conflict(name) do update set body_json = excluded.body_json, updated_at = excluded.updated_at
            """,
            (layout.name, layout.model_dump_json(), layout.created_at, layout.updated_at),
        )
        self._conn.commit()
        return layout

    def get_layout(self, name: str) -> WindowLayoutRecord | None:
        row = self._conn.execute("select body_json from window_layouts where name = ?", (name,)).fetchone()
        return WindowLayoutRecord.model_validate_json(row["body_json"]) if row else None

    def list_layouts(self) -> list[WindowLayoutRecord]:
        rows = self._conn.execute("select body_json from window_layouts order by updated_at desc").fetchall()
        return [WindowLayoutRecord.model_validate_json(row["body_json"]) for row in rows]

    def set_setting(self, key: str, value: Any) -> None:
        self._conn.execute(
            """
            insert into settings(key, value_json, updated_at) values (?, ?, ?)
            on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at
            """,
            (key, json.dumps(value), now_iso()),
        )
        self._conn.commit()

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self._conn.execute("select value_json from settings where key = ?", (key,)).fetchone()
        return json.loads(row["value_json"]) if row else default
