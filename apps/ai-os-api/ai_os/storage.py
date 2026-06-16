from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import UsageLogEntry, new_id, now_iso


class AppStorage:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self._lock, self._conn:
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

                create table if not exists job_events (
                  id text primary key,
                  job_id text not null,
                  created_at text not null,
                  level text not null,
                  message text not null,
                  payload text not null
                );
                """
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

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
