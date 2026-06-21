from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import (
    ActionSnapshotRecord,
    BenchmarkRunRecord,
    DesignPatchRecord,
    GenerationAssetRecord,
    MachineProfileSnapshotRecord,
    ToolCallLogEntry,
    UsageLogEntry,
    new_id,
    now_iso,
)

CURRENT_SCHEMA_VERSION = 4


class AppStorage:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("pragma foreign_keys = on")
        self._conn.execute("pragma journal_mode = wal")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock, self._conn:
            self._conn.executescript(
                """
                create table if not exists schema_migrations (
                  version integer primary key,
                  name text not null,
                  applied_at text not null,
                  reversible integer not null default 0,
                  checksum text not null
                );
                """
            )
            current = self.schema_version()
            if current < 1:
                self._apply_0001_initial()
            if current < 2:
                self._apply_0002_ai_layer()
            if current < 3:
                self._apply_0003_machine_profile()
            if current < 4:
                self._apply_0004_action_snapshots()

    def _apply_0001_initial(self) -> None:
        self._conn.executescript(
            """
            create table if not exists usage_log (
              id text primary key,
              created_at text not null,
              provider text not null,
              model text not null,
              task_type text not null,
              ok integer not null,
              input_tokens integer not null,
              output_tokens integer not null,
              total_tokens integer not null,
              cost_usd real not null,
              latency_ms real not null,
              fallback_chain text not null,
              error text,
              metadata text not null
            );

            create table if not exists memory_documents (
              id text primary key,
              source_type text not null,
              source_id text not null,
              title text,
              metadata text not null,
              created_at text not null,
              updated_at text not null,
              unique(source_type, source_id)
            );

            create table if not exists memory_chunks (
              id text primary key,
              document_id text not null,
              chunk_index integer not null,
              text text not null,
              embedding text not null,
              metadata text not null,
              created_at text not null,
              foreign key(document_id) references memory_documents(id)
            );

            create index if not exists idx_memory_chunks_document on memory_chunks(document_id);
            create index if not exists idx_usage_created_at on usage_log(created_at);

            create table if not exists job_events (
              id text primary key,
              job_id text not null,
              created_at text not null,
              level text not null,
              message text not null,
              payload text not null
            );
            create index if not exists idx_job_events_job on job_events(job_id, created_at);
            """
        )
        self._conn.execute(
            """
            insert or ignore into schema_migrations (version, name, applied_at, reversible, checksum)
            values (?, ?, ?, ?, ?)
            """,
            (1, "0001_initial_ai_os_schema", now_iso(), 0, "builtin:0001_initial_ai_os_schema"),
        )

    def _apply_0002_ai_layer(self) -> None:
        self._conn.executescript(
            """
            create table if not exists tool_call_log (
              id text primary key,
              created_at text not null,
              tool_id text not null,
              ok integer not null,
              safety text not null,
              requires_confirmation integer not null,
              arguments text not null,
              result text not null,
              error text,
              latency_ms real not null,
              run_id text
            );
            create index if not exists idx_tool_call_log_created_at on tool_call_log(created_at);
            create index if not exists idx_tool_call_log_tool_id on tool_call_log(tool_id);

            create table if not exists design_patches (
              id text primary key,
              created_at text not null,
              instruction text not null,
              target_files text not null,
              patch text not null,
              status text not null,
              applied_at text,
              reverted_at text,
              error text,
              metadata text not null
            );
            create index if not exists idx_design_patches_created_at on design_patches(created_at);

            create table if not exists generation_assets (
              id text primary key,
              created_at text not null,
              kind text not null,
              provider text not null,
              model text,
              prompt text,
              content_type text,
              asset_path text,
              metadata text not null
            );
            create index if not exists idx_generation_assets_created_at on generation_assets(created_at);

            create table if not exists benchmark_runs (
              id text primary key,
              created_at text not null,
              kind text not null,
              provider text,
              model text,
              prompt text not null,
              latency_ms real not null,
              tokens_per_second real,
              hardware_before text not null,
              hardware_after text not null,
              result text not null,
              ok integer not null,
              error text
            );
            create index if not exists idx_benchmark_runs_created_at on benchmark_runs(created_at);
            """
        )
        self._conn.execute(
            """
            insert or ignore into schema_migrations (version, name, applied_at, reversible, checksum)
            values (?, ?, ?, ?, ?)
            """,
            (2, "0002_ai_layer_capability_records", now_iso(), 0, "builtin:0002_ai_layer_capability_records"),
        )

    def _apply_0003_machine_profile(self) -> None:
        self._conn.executescript(
            """
            create table if not exists machine_profile_snapshots (
              id text primary key,
              created_at text not null,
              source text not null,
              profile text not null,
              autotune text not null
            );
            create index if not exists idx_machine_profile_snapshots_created_at
              on machine_profile_snapshots(created_at);
            """
        )
        self._conn.execute(
            """
            insert or ignore into schema_migrations (version, name, applied_at, reversible, checksum)
            values (?, ?, ?, ?, ?)
            """,
            (3, "0003_machine_profile_snapshots", now_iso(), 0, "builtin:0003_machine_profile_snapshots"),
        )

    def _apply_0004_action_snapshots(self) -> None:
        self._conn.executescript(
            """
            create table if not exists action_snapshots (
              id text primary key,
              created_at text not null,
              source text not null,
              action_type text not null,
              target text not null,
              content_type text not null,
              existed integer not null,
              snapshot_path text,
              size_bytes integer,
              metadata text not null
            );
            create index if not exists idx_action_snapshots_created_at
              on action_snapshots(created_at);
            create index if not exists idx_action_snapshots_action_type
              on action_snapshots(action_type);
            """
        )
        self._conn.execute(
            """
            insert or ignore into schema_migrations (version, name, applied_at, reversible, checksum)
            values (?, ?, ?, ?, ?)
            """,
            (4, "0004_action_snapshots", now_iso(), 0, "builtin:0004_action_snapshots"),
        )

    def schema_version(self) -> int:
        with self._lock:
            row = self._conn.execute("select max(version) as version from schema_migrations").fetchone()
        value = row["version"] if row else None
        return int(value or 0)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def backup_to(self, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._conn.commit()
            self._conn.execute("pragma wal_checkpoint(full)")
            backup_conn = sqlite3.connect(destination)
            try:
                self._conn.backup(backup_conn)
            finally:
                backup_conn.close()

    def data_counts(self) -> dict[str, int]:
        tables = [
            "usage_log",
            "memory_documents",
            "memory_chunks",
            "job_events",
            "tool_call_log",
            "design_patches",
            "generation_assets",
            "benchmark_runs",
            "machine_profile_snapshots",
            "action_snapshots",
            "schema_migrations",
        ]
        counts: dict[str, int] = {}
        with self._lock:
            for table in tables:
                row = self._conn.execute(f"select count(*) as count from {table}").fetchone()
                counts[table] = int(row["count"] if row else 0)
        return counts

    def integrity_report(self) -> dict[str, Any]:
        with self._lock:
            integrity_rows = self._conn.execute("pragma integrity_check").fetchall()
            foreign_key_rows = self._conn.execute("pragma foreign_key_check").fetchall()
            migrations = self._conn.execute(
                "select version, name, applied_at, reversible, checksum from schema_migrations order by version"
            ).fetchall()
            json_errors = self._json_validation_errors()
        integrity = [str(row[0]) for row in integrity_rows]
        foreign_key_errors = [dict(row) for row in foreign_key_rows]
        ok = integrity == ["ok"] and not foreign_key_errors and not json_errors and self.schema_version() == CURRENT_SCHEMA_VERSION
        return {
            "ok": ok,
            "schema_version": self.schema_version(),
            "expected_schema_version": CURRENT_SCHEMA_VERSION,
            "integrity": integrity,
            "foreign_key_errors": foreign_key_errors,
            "json_errors": json_errors,
            "counts": self.data_counts(),
            "migrations": [dict(row) for row in migrations],
            "database_path": str(self.db_path),
        }

    def _json_validation_errors(self) -> list[dict[str, Any]]:
        checks = [
            ("usage_log", "metadata"),
            ("usage_log", "fallback_chain"),
            ("memory_documents", "metadata"),
            ("memory_chunks", "metadata"),
            ("memory_chunks", "embedding"),
            ("job_events", "payload"),
            ("tool_call_log", "arguments"),
            ("tool_call_log", "result"),
            ("design_patches", "target_files"),
            ("design_patches", "metadata"),
            ("generation_assets", "metadata"),
            ("benchmark_runs", "hardware_before"),
            ("benchmark_runs", "hardware_after"),
            ("benchmark_runs", "result"),
            ("machine_profile_snapshots", "profile"),
            ("machine_profile_snapshots", "autotune"),
            ("action_snapshots", "metadata"),
        ]
        errors: list[dict[str, Any]] = []
        for table, column in checks:
            rows = self._conn.execute(f"select id, {column} as value from {table}").fetchall()
            for row in rows:
                try:
                    json.loads(row["value"])
                except Exception as error:
                    errors.append({"table": table, "column": column, "id": row["id"], "error": str(error)})
                    if len(errors) >= 25:
                        return errors
        return errors

    def log_usage(
        self,
        *,
        provider: str,
        model: str,
        task_type: str,
        ok: bool,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        latency_ms: float,
        fallback_chain: list[dict[str, Any]],
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> UsageLogEntry:
        entry = UsageLogEntry(
            id=new_id("usage"),
            created_at=now_iso(),
            provider=provider,
            model=model,
            task_type=task_type,
            ok=ok,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            fallback_chain=fallback_chain,
            error=error,
            metadata=metadata or {},
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into usage_log (
                  id, created_at, provider, model, task_type, ok, input_tokens, output_tokens,
                  total_tokens, cost_usd, latency_ms, fallback_chain, error, metadata
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.id,
                    entry.created_at,
                    entry.provider,
                    entry.model,
                    entry.task_type,
                    1 if entry.ok else 0,
                    entry.input_tokens,
                    entry.output_tokens,
                    entry.total_tokens,
                    entry.cost_usd,
                    entry.latency_ms,
                    json.dumps(entry.fallback_chain),
                    entry.error,
                    json.dumps(entry.metadata),
                ),
            )
        return entry

    def list_usage(self, limit: int = 50) -> list[UsageLogEntry]:
        with self._lock:
            rows = self._conn.execute(
                "select * from usage_log order by created_at desc limit ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [
            UsageLogEntry(
                id=row["id"],
                created_at=row["created_at"],
                provider=row["provider"],
                model=row["model"],
                task_type=row["task_type"],
                ok=bool(row["ok"]),
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                total_tokens=row["total_tokens"],
                cost_usd=row["cost_usd"],
                latency_ms=row["latency_ms"],
                fallback_chain=json.loads(row["fallback_chain"]),
                error=row["error"],
                metadata=json.loads(row["metadata"]),
            )
            for row in rows
        ]

    def recent_provider_latency(self, provider: str) -> float | None:
        with self._lock:
            row = self._conn.execute(
                "select avg(latency_ms) as avg_latency from usage_log where provider = ? and ok = 1",
                (provider,),
            ).fetchone()
        value = row["avg_latency"] if row else None
        return float(value) if value is not None else None

    def recent_tokens_per_second(self) -> float | None:
        entries = self.list_usage(limit=20)
        values = [
            float(entry.metadata["tokens_per_second"])
            for entry in entries
            if isinstance(entry.metadata.get("tokens_per_second"), (int, float)) and entry.metadata["tokens_per_second"] > 0
        ]
        if not values:
            return None
        return sum(values) / len(values)

    def recent_provider_tokens_per_second(self, provider: str) -> float | None:
        with self._lock:
            benchmark_rows = self._conn.execute(
                """
                select avg(tokens_per_second) as avg_tokens_per_second
                from (
                  select tokens_per_second
                  from benchmark_runs
                  where provider = ? and ok = 1 and tokens_per_second is not null and tokens_per_second > 0
                  order by created_at desc
                  limit 20
                )
                """,
                (provider,),
            ).fetchone()
        benchmark_value = benchmark_rows["avg_tokens_per_second"] if benchmark_rows else None
        if benchmark_value is not None:
            return float(benchmark_value)

        entries = [
            entry
            for entry in self.list_usage(limit=100)
            if entry.provider == provider
            and isinstance(entry.metadata.get("tokens_per_second"), (int, float))
            and entry.metadata["tokens_per_second"] > 0
        ][:20]
        if not entries:
            return None
        return sum(float(entry.metadata["tokens_per_second"]) for entry in entries) / len(entries)

    def upsert_document(self, source_type: str, source_id: str, title: str | None, metadata: dict[str, Any]) -> str:
        now = now_iso()
        with self._lock, self._conn:
            existing = self._conn.execute(
                "select id from memory_documents where source_type = ? and source_id = ?",
                (source_type, source_id),
            ).fetchone()
            if existing:
                document_id = existing["id"]
                self._conn.execute(
                    """
                    update memory_documents
                    set title = ?, metadata = ?, updated_at = ?
                    where id = ?
                    """,
                    (title, json.dumps(metadata), now, document_id),
                )
                self._conn.execute("delete from memory_chunks where document_id = ?", (document_id,))
                return str(document_id)

            document_id = new_id("doc")
            self._conn.execute(
                """
                insert into memory_documents (id, source_type, source_id, title, metadata, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (document_id, source_type, source_id, title, json.dumps(metadata), now, now),
            )
            return document_id

    def add_memory_chunk(
        self,
        *,
        document_id: str,
        chunk_index: int,
        text: str,
        embedding: list[float],
        metadata: dict[str, Any],
    ) -> str:
        chunk_id = new_id("chunk")
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into memory_chunks (id, document_id, chunk_index, text, embedding, metadata, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk_id, document_id, chunk_index, text, json.dumps(embedding), json.dumps(metadata), now_iso()),
            )
        return chunk_id

    def iter_memory_chunks(self) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(
                """
                select
                  c.id as chunk_id,
                  c.document_id,
                  c.text,
                  c.embedding,
                  c.metadata as chunk_metadata,
                  d.source_type,
                  d.source_id,
                  d.title,
                  d.metadata as document_metadata
                from memory_chunks c
                join memory_documents d on d.id = c.document_id
                order by c.created_at desc
                """
            ).fetchall()

    def log_job_event(self, job_id: str, level: str, message: str, payload: dict[str, Any] | None = None) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "insert into job_events (id, job_id, created_at, level, message, payload) values (?, ?, ?, ?, ?, ?)",
                (new_id("jobevt"), job_id, now_iso(), level, message, json.dumps(payload or {})),
            )

    def log_tool_call(
        self,
        *,
        tool_id: str,
        ok: bool,
        safety: str,
        requires_confirmation: bool,
        arguments: dict[str, Any],
        result: dict[str, Any] | None = None,
        error: str | None = None,
        latency_ms: float = 0.0,
        run_id: str | None = None,
    ) -> ToolCallLogEntry:
        entry = ToolCallLogEntry(
            id=new_id("tool"),
            created_at=now_iso(),
            tool_id=tool_id,
            ok=ok,
            safety=safety if safety in {"read", "write", "destructive"} else "read",
            requires_confirmation=requires_confirmation,
            arguments=arguments,
            result=result or {},
            error=error,
            latency_ms=latency_ms,
            run_id=run_id,
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into tool_call_log (
                  id, created_at, tool_id, ok, safety, requires_confirmation,
                  arguments, result, error, latency_ms, run_id
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.id,
                    entry.created_at,
                    entry.tool_id,
                    1 if entry.ok else 0,
                    entry.safety,
                    1 if entry.requires_confirmation else 0,
                    json.dumps(entry.arguments),
                    json.dumps(entry.result),
                    entry.error,
                    entry.latency_ms,
                    entry.run_id,
                ),
            )
        return entry

    def list_tool_calls(self, limit: int = 50) -> list[ToolCallLogEntry]:
        with self._lock:
            rows = self._conn.execute(
                "select * from tool_call_log order by created_at desc limit ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [
            ToolCallLogEntry(
                id=row["id"],
                created_at=row["created_at"],
                tool_id=row["tool_id"],
                ok=bool(row["ok"]),
                safety=row["safety"],
                requires_confirmation=bool(row["requires_confirmation"]),
                arguments=json.loads(row["arguments"]),
                result=json.loads(row["result"]),
                error=row["error"],
                latency_ms=row["latency_ms"],
                run_id=row["run_id"],
            )
            for row in rows
        ]

    def create_design_patch(
        self,
        *,
        instruction: str,
        target_files: list[str],
        patch: str,
        status: str = "proposed",
        metadata: dict[str, Any] | None = None,
    ) -> DesignPatchRecord:
        record = DesignPatchRecord(
            id=new_id("patch"),
            created_at=now_iso(),
            instruction=instruction,
            target_files=target_files,
            patch=patch,
            status=status if status in {"proposed", "applied", "reverted", "failed"} else "proposed",
            metadata=metadata or {},
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into design_patches (
                  id, created_at, instruction, target_files, patch, status,
                  applied_at, reverted_at, error, metadata
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.instruction,
                    json.dumps(record.target_files),
                    record.patch,
                    record.status,
                    record.applied_at,
                    record.reverted_at,
                    record.error,
                    json.dumps(record.metadata),
                ),
            )
        return record

    def get_design_patch(self, patch_id: str) -> DesignPatchRecord | None:
        with self._lock:
            row = self._conn.execute("select * from design_patches where id = ?", (patch_id,)).fetchone()
        if not row:
            return None
        return DesignPatchRecord(
            id=row["id"],
            created_at=row["created_at"],
            instruction=row["instruction"],
            target_files=json.loads(row["target_files"]),
            patch=row["patch"],
            status=row["status"],
            applied_at=row["applied_at"],
            reverted_at=row["reverted_at"],
            error=row["error"],
            metadata=json.loads(row["metadata"]),
        )

    def list_design_patches(self, limit: int = 25) -> list[DesignPatchRecord]:
        with self._lock:
            rows = self._conn.execute(
                "select * from design_patches order by created_at desc limit ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
        return [
            DesignPatchRecord(
                id=row["id"],
                created_at=row["created_at"],
                instruction=row["instruction"],
                target_files=json.loads(row["target_files"]),
                patch=row["patch"],
                status=row["status"],
                applied_at=row["applied_at"],
                reverted_at=row["reverted_at"],
                error=row["error"],
                metadata=json.loads(row["metadata"]),
            )
            for row in rows
        ]

    def update_design_patch_status(
        self,
        patch_id: str,
        *,
        status: str,
        error: str | None = None,
        applied_at: str | None = None,
        reverted_at: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DesignPatchRecord:
        existing = self.get_design_patch(patch_id)
        if not existing:
            raise KeyError(patch_id)
        next_metadata = existing.metadata if metadata is None else metadata
        with self._lock, self._conn:
            self._conn.execute(
                """
                update design_patches
                set status = ?, error = ?, applied_at = coalesce(?, applied_at),
                    reverted_at = coalesce(?, reverted_at), metadata = ?
                where id = ?
                """,
                (status, error, applied_at, reverted_at, json.dumps(next_metadata), patch_id),
            )
        updated = self.get_design_patch(patch_id)
        if not updated:
            raise KeyError(patch_id)
        return updated

    def log_generation_asset(
        self,
        *,
        kind: str,
        provider: str,
        model: str | None = None,
        prompt: str | None = None,
        content_type: str | None = None,
        asset_path: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> GenerationAssetRecord:
        record = GenerationAssetRecord(
            id=new_id("asset"),
            created_at=now_iso(),
            kind=kind,
            provider=provider,
            model=model,
            prompt=prompt,
            content_type=content_type,
            asset_path=asset_path,
            metadata=metadata or {},
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into generation_assets (
                  id, created_at, kind, provider, model, prompt, content_type, asset_path, metadata
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.kind,
                    record.provider,
                    record.model,
                    record.prompt,
                    record.content_type,
                    record.asset_path,
                    json.dumps(record.metadata),
                ),
            )
        return record

    def list_generation_assets(self, limit: int = 50) -> list[GenerationAssetRecord]:
        with self._lock:
            rows = self._conn.execute(
                "select * from generation_assets order by created_at desc limit ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [
            GenerationAssetRecord(
                id=row["id"],
                created_at=row["created_at"],
                kind=row["kind"],
                provider=row["provider"],
                model=row["model"],
                prompt=row["prompt"],
                content_type=row["content_type"],
                asset_path=row["asset_path"],
                metadata=json.loads(row["metadata"]),
            )
            for row in rows
        ]

    def log_action_snapshot(
        self,
        *,
        snapshot_id: str | None = None,
        source: str,
        action_type: str,
        target: str,
        content_type: str,
        existed: bool,
        snapshot_path: str | None = None,
        size_bytes: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ActionSnapshotRecord:
        record = ActionSnapshotRecord(
            id=snapshot_id or new_id("snapshot"),
            created_at=now_iso(),
            source=source,
            action_type=action_type,
            target=target,
            content_type=content_type,
            existed=existed,
            snapshot_path=snapshot_path,
            size_bytes=size_bytes,
            metadata=metadata or {},
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into action_snapshots (
                  id, created_at, source, action_type, target, content_type,
                  existed, snapshot_path, size_bytes, metadata
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.source,
                    record.action_type,
                    record.target,
                    record.content_type,
                    1 if record.existed else 0,
                    record.snapshot_path,
                    record.size_bytes,
                    json.dumps(record.metadata),
                ),
            )
        return record

    def get_action_snapshot(self, snapshot_id: str) -> ActionSnapshotRecord | None:
        with self._lock:
            row = self._conn.execute("select * from action_snapshots where id = ?", (snapshot_id,)).fetchone()
        if not row:
            return None
        return ActionSnapshotRecord(
            id=row["id"],
            created_at=row["created_at"],
            source=row["source"],
            action_type=row["action_type"],
            target=row["target"],
            content_type=row["content_type"],
            existed=bool(row["existed"]),
            snapshot_path=row["snapshot_path"],
            size_bytes=row["size_bytes"],
            metadata=json.loads(row["metadata"]),
        )

    def list_action_snapshots(self, limit: int = 50) -> list[ActionSnapshotRecord]:
        with self._lock:
            rows = self._conn.execute(
                "select * from action_snapshots order by created_at desc limit ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [
            ActionSnapshotRecord(
                id=row["id"],
                created_at=row["created_at"],
                source=row["source"],
                action_type=row["action_type"],
                target=row["target"],
                content_type=row["content_type"],
                existed=bool(row["existed"]),
                snapshot_path=row["snapshot_path"],
                size_bytes=row["size_bytes"],
                metadata=json.loads(row["metadata"]),
            )
            for row in rows
        ]

    def log_benchmark(self, record: BenchmarkRunRecord) -> BenchmarkRunRecord:
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into benchmark_runs (
                  id, created_at, kind, provider, model, prompt, latency_ms, tokens_per_second,
                  hardware_before, hardware_after, result, ok, error
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.kind,
                    record.provider,
                    record.model,
                    record.prompt,
                    record.latency_ms,
                    record.tokens_per_second,
                    json.dumps(record.hardware_before),
                    json.dumps(record.hardware_after),
                    json.dumps(record.result),
                    1 if record.ok else 0,
                    record.error,
                ),
            )
        return record

    def list_benchmarks(self, limit: int = 25) -> list[BenchmarkRunRecord]:
        with self._lock:
            rows = self._conn.execute(
                "select * from benchmark_runs order by created_at desc limit ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
        return [
            BenchmarkRunRecord(
                id=row["id"],
                created_at=row["created_at"],
                kind=row["kind"],
                provider=row["provider"],
                model=row["model"],
                prompt=row["prompt"],
                latency_ms=row["latency_ms"],
                tokens_per_second=row["tokens_per_second"],
                hardware_before=json.loads(row["hardware_before"]),
                hardware_after=json.loads(row["hardware_after"]),
                result=json.loads(row["result"]),
                ok=bool(row["ok"]),
                error=row["error"],
            )
            for row in rows
        ]

    def log_machine_profile_snapshot(
        self,
        *,
        source: str,
        profile: dict[str, Any],
        autotune: dict[str, Any] | None = None,
    ) -> MachineProfileSnapshotRecord:
        record = MachineProfileSnapshotRecord(
            id=new_id("profile"),
            created_at=now_iso(),
            source=source,
            profile=profile,
            autotune=autotune or {},
        )
        with self._lock, self._conn:
            self._conn.execute(
                """
                insert into machine_profile_snapshots (id, created_at, source, profile, autotune)
                values (?, ?, ?, ?, ?)
                """,
                (record.id, record.created_at, record.source, json.dumps(record.profile), json.dumps(record.autotune)),
            )
        return record

    def list_machine_profile_snapshots(self, limit: int = 10) -> list[MachineProfileSnapshotRecord]:
        with self._lock:
            rows = self._conn.execute(
                "select * from machine_profile_snapshots order by created_at desc limit ?",
                (max(1, min(limit, 100)),),
            ).fetchall()
        return [
            MachineProfileSnapshotRecord(
                id=row["id"],
                created_at=row["created_at"],
                source=row["source"],
                profile=json.loads(row["profile"]),
                autotune=json.loads(row["autotune"]),
            )
            for row in rows
        ]

    def usage_metrics(self) -> dict[str, Any]:
        with self._lock:
            total = self._conn.execute("select count(*) as count from usage_log").fetchone()["count"]
            failed = self._conn.execute("select count(*) as count from usage_log where ok = 0").fetchone()["count"]
            latency_rows = self._conn.execute(
                """
                select provider, avg(latency_ms) as avg_latency_ms, count(*) as count
                from usage_log
                where ok = 1
                group by provider
                order by provider
                """
            ).fetchall()
        return {
            "total_calls": int(total),
            "failed_calls": int(failed),
            "failure_rate": (float(failed) / float(total)) if total else 0.0,
            "latency_by_provider": [dict(row) for row in latency_rows],
        }
