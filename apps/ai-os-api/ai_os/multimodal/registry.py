from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ..config import Settings
from ..models import ChatMessage, InferenceRequest, MultimodalInvokeRequest
from ..providers.ollama import OllamaProvider
from ..providers.openai_provider import OpenAIProvider
from ..providers.registry import ProviderRegistry
from ..storage import AppStorage


class MultimodalRegistry:
    def __init__(self, settings: Settings, providers: ProviderRegistry, storage: AppStorage):
        self.settings = settings
        self.providers = providers
        self.storage = storage

    async def invoke(self, kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        provider_id = request.provider or self._default_provider(kind)
        if provider_id == "comfyui":
            result = await self._comfyui_image(request)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id == "piper":
            result = await asyncio.to_thread(self._piper_tts, request)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id == "whisper":
            result = await asyncio.to_thread(self._whisper_stt, request)
            return self._record_asset(kind, provider_id, request, result)

        provider = self.providers.get(provider_id)
        if not provider:
            raise ValueError(f"Unknown multimodal provider: {provider_id}")

        if kind == "image":
            if isinstance(provider, OpenAIProvider):
                result = await provider.generate_image(request.prompt or "", request.model, request.options)
                return self._record_asset(kind, provider_id, request, result)
            raise ValueError(f"Provider {provider_id} does not expose image generation. Use provider='comfyui' for local image generation.")

        if kind == "audio_tts":
            if isinstance(provider, OpenAIProvider):
                result = await provider.tts(request.text or request.prompt or "", request.model, request.options)
                return self._record_asset(kind, provider_id, request, result)
            raise ValueError(f"Provider {provider_id} does not expose text-to-speech. Use provider='piper' for local TTS.")

        if kind == "audio_stt":
            if isinstance(provider, OpenAIProvider):
                if not request.audio_base64:
                    raise ValueError("audio_base64 is required for speech-to-text.")
                result = await provider.stt(request.audio_base64, request.filename or "audio.webm", request.model, request.options)
                return self._record_asset(kind, provider_id, request, result)
            raise ValueError(f"Provider {provider_id} does not expose speech-to-text. Use provider='whisper' for local STT.")

        if kind == "vision":
            if isinstance(provider, OllamaProvider):
                result = await self._ollama_vision(provider, request)
                return self._record_asset(kind, provider_id, request, result)
            result = await provider.complete(
                InferenceRequest(
                    task_type="vision",
                    provider=provider_id,
                    model=request.model,
                    messages=[ChatMessage(role="user", content=request.prompt or "Describe this image.")],
                    metadata={"image_base64_present": bool(request.image_base64)},
                )
            )
            return self._record_asset(kind, provider_id, request, result.model_dump(mode="json"))

        raise ValueError(f"Unknown multimodal kind: {kind}")

    def _default_provider(self, kind: str) -> str:
        if kind == "vision":
            return "ollama"
        if kind == "image" and self.settings.comfyui_base_url:
            return "comfyui"
        if kind == "audio_tts" and self.settings.piper_executable:
            return "piper"
        if kind == "audio_stt" and self.settings.whisper_executable:
            return "whisper"
        return "openai"

    async def _ollama_vision(self, provider: OllamaProvider, request: MultimodalInvokeRequest) -> dict[str, Any]:
        if not request.image_base64:
            raise ValueError("image_base64 is required for Ollama vision.")
        import httpx

        payload = {
            "model": request.model or provider.settings.ollama_chat_model,
            "prompt": request.prompt or "Describe this image.",
            "images": [request.image_base64],
            "stream": False,
            "options": {"num_ctx": provider.settings.ollama_context_tokens},
        }
        async with httpx.AsyncClient(timeout=provider.settings.ollama_timeout_s) as client:
            response = await client.post(provider._url("/generate"), json=payload)
            response.raise_for_status()
            data = response.json()
        data.setdefault("provider", "ollama")
        data.setdefault("model", payload["model"])
        return data

    async def _comfyui_image(self, request: MultimodalInvokeRequest) -> dict[str, Any]:
        if not self.settings.comfyui_base_url:
            raise ValueError("COMFYUI_BASE_URL is not configured.")
        workflow = request.options.get("workflow")
        if workflow is None:
            if not self.settings.comfyui_workflow_path:
                raise ValueError("COMFYUI_WORKFLOW_PATH or options.workflow is required for local ComfyUI image generation.")
            workflow = json.loads(Path(self.settings.comfyui_workflow_path).read_text(encoding="utf-8"))
        elif isinstance(workflow, str):
            workflow = json.loads(workflow)
        if not isinstance(workflow, dict):
            raise ValueError("ComfyUI workflow must be a JSON object.")
        workflow = self._inject_prompt(workflow, request.prompt or "")

        import httpx

        base_url = self.settings.comfyui_base_url.rstrip("/")
        async with httpx.AsyncClient(timeout=self.settings.comfyui_timeout_s) as client:
            response = await client.post(f"{base_url}/prompt", json={"prompt": workflow})
            response.raise_for_status()
            prompt_id = response.json().get("prompt_id")
            if not prompt_id:
                raise RuntimeError("ComfyUI did not return prompt_id.")
            history: dict[str, Any] | None = None
            for _ in range(max(1, int(self.settings.comfyui_timeout_s))):
                await asyncio.sleep(1)
                poll = await client.get(f"{base_url}/history/{prompt_id}")
                poll.raise_for_status()
                data = poll.json()
                history = data.get(prompt_id)
                if history and history.get("outputs"):
                    break
            if not history:
                raise TimeoutError("ComfyUI image generation timed out.")
            image_ref = self._first_comfyui_image(history)
            if not image_ref:
                return {"provider": "comfyui", "model": request.model or "workflow", "prompt_id": prompt_id, "history": history}
            view = await client.get(
                f"{base_url}/view",
                params={
                    "filename": image_ref.get("filename"),
                    "subfolder": image_ref.get("subfolder", ""),
                    "type": image_ref.get("type", "output"),
                },
            )
            view.raise_for_status()
            return {
                "provider": "comfyui",
                "model": request.model or "workflow",
                "prompt_id": prompt_id,
                "image_base64": base64.b64encode(view.content).decode("ascii"),
                "content_type": view.headers.get("content-type", "image/png"),
                "history": {"outputs": history.get("outputs", {})},
            }

    def _inject_prompt(self, value: Any, prompt: str) -> Any:
        if isinstance(value, dict):
            next_value = {key: self._inject_prompt(item, prompt) for key, item in value.items()}
            inputs = next_value.get("inputs")
            class_type = str(next_value.get("class_type") or "")
            if isinstance(inputs, dict) and class_type.lower() == "cliptextencode":
                inputs["text"] = prompt
            return next_value
        if isinstance(value, list):
            return [self._inject_prompt(item, prompt) for item in value]
        if isinstance(value, str) and "{{prompt}}" in value:
            return value.replace("{{prompt}}", prompt)
        return value

    def _first_comfyui_image(self, history: dict[str, Any]) -> dict[str, Any] | None:
        outputs = history.get("outputs")
        if not isinstance(outputs, dict):
            return None
        for output in outputs.values():
            images = output.get("images") if isinstance(output, dict) else None
            if isinstance(images, list) and images:
                first = images[0]
                if isinstance(first, dict):
                    return first
        return None

    def _piper_tts(self, request: MultimodalInvokeRequest) -> dict[str, Any]:
        if not self.settings.piper_executable or not self.settings.piper_voice_path:
            raise ValueError("PIPER_EXECUTABLE and PIPER_VOICE_PATH are required for local Piper TTS.")
        text = request.text or request.prompt or ""
        if not text:
            raise ValueError("text or prompt is required for TTS.")
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "speech.wav"
            completed = subprocess.run(
                [
                    self.settings.piper_executable,
                    "--model",
                    str(self.settings.piper_voice_path),
                    "--output_file",
                    str(output_path),
                ],
                input=text,
                capture_output=True,
                text=True,
                timeout=self.settings.piper_timeout_s,
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError((completed.stderr or completed.stdout or "Piper failed.").strip())
            audio = output_path.read_bytes()
        return {
            "provider": "piper",
            "model": str(self.settings.piper_voice_path),
            "content_type": "audio/wav",
            "audio_base64": base64.b64encode(audio).decode("ascii"),
        }

    def _whisper_stt(self, request: MultimodalInvokeRequest) -> dict[str, Any]:
        if not self.settings.whisper_executable:
            raise ValueError("WHISPER_EXECUTABLE is required for local Whisper STT.")
        if not request.audio_base64:
            raise ValueError("audio_base64 is required for speech-to-text.")
        audio = base64.b64decode(request.audio_base64)
        suffix = Path(request.filename or "audio.webm").suffix or ".webm"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            input_path = tmp_path / f"audio{suffix}"
            input_path.write_bytes(audio)
            completed = subprocess.run(
                [
                    self.settings.whisper_executable,
                    str(input_path),
                    "--model",
                    self.settings.whisper_model,
                    "--output_dir",
                    str(tmp_path),
                    "--output_format",
                    "txt",
                ],
                capture_output=True,
                text=True,
                timeout=self.settings.whisper_timeout_s,
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError((completed.stderr or completed.stdout or "Whisper failed.").strip())
            transcript_path = tmp_path / f"{input_path.stem}.txt"
            transcript = transcript_path.read_text(encoding="utf-8").strip() if transcript_path.exists() else completed.stdout.strip()
        return {"provider": "whisper", "model": self.settings.whisper_model, "text": transcript}

    def _record_asset(
        self,
        kind: str,
        provider_id: str,
        request: MultimodalInvokeRequest,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        if not request.save_to_gallery:
            return result
        prompt = request.prompt or request.text
        content_type = result.get("content_type") if isinstance(result.get("content_type"), str) else None
        asset_path = self._persist_binary_asset(kind, result, content_type)
        record = self.storage.log_generation_asset(
            kind=kind,
            provider=str(result.get("provider") or provider_id),
            model=str(result.get("model") or request.model or "") or None,
            prompt=prompt,
            content_type=content_type,
            asset_path=asset_path,
            metadata={
                key: value
                for key, value in result.items()
                if key not in {"image_base64", "audio_base64"}
            },
        )
        enriched = dict(result)
        enriched["asset"] = record.model_dump(mode="json")
        return enriched

    def _persist_binary_asset(self, kind: str, result: dict[str, Any], content_type: str | None) -> str | None:
        payload = None
        extension = ".bin"
        if isinstance(result.get("image_base64"), str):
            payload = result["image_base64"]
            extension = ".png" if content_type != "image/jpeg" else ".jpg"
        elif isinstance(result.get("audio_base64"), str):
            payload = result["audio_base64"]
            extension = ".wav" if content_type == "audio/wav" else ".mp3"
        elif isinstance(result.get("data"), list):
            for item in result["data"]:
                if isinstance(item, dict) and isinstance(item.get("b64_json"), str):
                    payload = item["b64_json"]
                    extension = ".png"
                    break
        if not payload:
            return None
        directory = self.settings.resolved_assets_dir() / "generations" / kind
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"generation-{len(list(directory.glob('*'))) + 1}{extension}"
        path.write_bytes(base64.b64decode(payload))
        return str(path)
