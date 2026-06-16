from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from ..inference import estimate_tokens
from ..models import MemoryHit, MemoryIngestRequest, MemoryQueryRequest
from ..providers.registry import ProviderRegistry
from ..storage import AppStorage


def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    cleaned = text.strip()
    if not cleaned:
        return []
    chunk_size = max(200, chunk_size)
    overlap = max(0, min(overlap, chunk_size // 2))
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunks.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = end - overlap
    return chunks


def hash_embedding(text: str, dimensions: int = 256) -> list[float]:
    vector = [0.0] * dimensions
    words = text.lower().split()
    if not words:
        return vector
    for word in words:
        digest = hashlib.sha256(word.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1 if digest[4] % 2 == 0 else -1
        vector[idx] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1
    return [value / norm for value in vector]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    length = min(len(a), len(b))
    dot = sum(a[index] * b[index] for index in range(length))
    norm_a = math.sqrt(sum(value * value for value in a[:length]))
    norm_b = math.sqrt(sum(value * value for value in b[:length]))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


class SemanticMemory:
    def __init__(self, storage: AppStorage, providers: ProviderRegistry):
        self.storage = storage
        self.providers = providers

    async def _embed(self, texts: list[str], provider_id: str | None, model: str | None) -> list[list[float]]:
        provider_ids = [provider_id] if provider_id else ["ollama", "openai"]
        for candidate_id in provider_ids:
            provider = self.providers.get(candidate_id)
            if not provider:
                continue
            try:
                return await provider.embed(texts, model)
            except Exception:
                continue
        return [hash_embedding(text) for text in texts]

    async def ingest(self, request: MemoryIngestRequest) -> dict[str, Any]:
        chunks = chunk_text(request.text, request.chunk_size, request.overlap)
        document_id = self.storage.upsert_document(request.source_type, request.source_id, request.title, request.metadata)
        embeddings = await self._embed(chunks, request.embedding_provider, request.embedding_model)
        for index, chunk in enumerate(chunks):
            metadata = {"token_estimate": estimate_tokens(chunk), **request.metadata}
            self.storage.add_memory_chunk(document_id=document_id, chunk_index=index, text=chunk, embedding=embeddings[index], metadata=metadata)
        return {"document_id": document_id, "chunks": len(chunks), "embedding_dimensions": len(embeddings[0]) if embeddings else 0}

    async def query(self, request: MemoryQueryRequest) -> list[MemoryHit]:
        [query_embedding] = await self._embed([request.query], request.embedding_provider, request.embedding_model)
        hits: list[MemoryHit] = []
        for row in self.storage.iter_memory_chunks():
            embedding = [float(value) for value in json.loads(row["embedding"])]
            metadata = json.loads(row["document_metadata"])
            metadata.update(json.loads(row["chunk_metadata"]))
            hits.append(
                MemoryHit(
                    chunk_id=row["chunk_id"],
                    document_id=row["document_id"],
                    source_type=row["source_type"],
                    source_id=row["source_id"],
                    title=row["title"],
                    text=row["text"],
                    score=cosine(query_embedding, embedding),
                    metadata=metadata,
                )
            )
        hits.sort(key=lambda hit: hit.score, reverse=True)
        return hits[: max(1, min(request.limit, 50))]
