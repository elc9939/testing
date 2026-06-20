from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ..config import Settings
from ..media_engine import BuiltinMediaEngine
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
        self.builtin = BuiltinMediaEngine(settings)

    def capability_adapters(self) -> dict[str, dict[str, bool]]:
        return {
            "multimodal.image": {
                "builtin-image": self.settings.builtin_media_enabled,
                "comfyui": bool(self.settings.comfyui_base_url),
                "local-image": bool(self.settings.local_image_command),
            },
            "multimodal.audio": {
                "builtin-audio": self.settings.builtin_media_enabled,
                "local-audio": bool(self.settings.local_audio_command),
            },
            "multimodal.audio_tts": {
                "piper": bool(self.settings.piper_executable and self.settings.piper_voice_path),
            },
            "multimodal.audio_stt": {
                "whisper": bool(self.settings.whisper_executable),
            },
            "multimodal.video": {
                "builtin-video": self.settings.builtin_media_enabled,
                "comfyui": bool(self.settings.comfyui_base_url and self.settings.comfyui_video_workflow_path),
                "local-video": bool(self.settings.local_video_command),
            },
        }

    async def invoke(self, kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        provider_id = request.provider or self._default_provider(kind)
        if provider_id == "comfyui":
            if kind not in {"image", "video"}:
                raise ValueError("ComfyUI is available for image/video workflows.")
            result = await self._comfyui_media(request, kind)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id == "piper":
            result = await asyncio.to_thread(self._piper_tts, request)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id == "whisper":
            result = await asyncio.to_thread(self._whisper_stt, request)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id in {"builtin-image", "builtin-audio", "builtin-video"}:
            expected = provider_id.removeprefix("builtin-")
            if kind != expected:
                raise ValueError(f"Provider {provider_id} only handles kind='{expected}'.")
            if not self.settings.builtin_media_enabled:
                raise ValueError("Built-in local media generation is disabled.")
            result = await self.builtin.invoke(kind, request)
            return self._record_asset(kind, provider_id, request, result)
        if provider_id in {"local-image", "local-audio", "local-video"}:
            expected = provider_id.removeprefix("local-")
            if kind != expected:
                raise ValueError(f"Provider {provider_id} only handles kind='{expected}'.")
            result = await asyncio.to_thread(self._local_media_command, kind, request)
            return self._record_asset(kind, provider_id, request, result)

        provider = self.providers.get(provider_id)
        if not provider:
            raise ValueError(f"Unknown multimodal provider: {provider_id}")

        if kind == "image":
            if isinstance(provider, OpenAIProvider):
                result = await provider.generate_image(request.prompt or "", request.model, request.options)
                return self._record_asset(kind, provider_id, request, result)
            raise ValueError("This provider does not expose image generation. Use provider='comfyui' or provider='local-image' for local image generation.")

        if kind == "audio":
            raise ValueError("Audio generation requires provider='local-audio' and AI_OS_LOCAL_AUDIO_COMMAND.")

        if kind == "video":
            raise ValueError("Video generation requires provider='local-video' or a configured ComfyUI video workflow.")

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
        if kind == "image" and self.settings.local_image_command:
            return "local-image"
        if kind == "image" and self.settings.builtin_media_enabled:
            return "builtin-image"
        if kind == "image" and self.settings.comfyui_base_url:
            return "comfyui"
        if kind == "audio" and self.settings.local_audio_command:
            return "local-audio"
        if kind == "audio" and self.settings.builtin_media_enabled:
            return "builtin-audio"
        if kind == "video" and self.settings.local_video_command:
            return "local-video"
        if kind == "video" and self.settings.builtin_media_enabled:
            return "builtin-video"
        if kind == "video" and self.settings.comfyui_base_url and self.settings.comfyui_video_workflow_path:
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

    async def _comfyui_media(self, request: MultimodalInvokeRequest, kind: str) -> dict[str, Any]:
        if not self.settings.comfyui_base_url:
            raise ValueError("COMFYUI_BASE_URL is not configured.")
        workflow = request.options.get("workflow")
        if workflow is None:
            workflow_path = self._comfyui_workflow_path(kind)
            if not workflow_path:
                raise ValueError(f"A ComfyUI workflow path or options.workflow is required for local {kind} generation.")
            workflow = json.loads(Path(workflow_path).read_text(encoding="utf-8"))
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
            output_ref = self._first_comfyui_output(history, kind)
            if not output_ref:
                return {"provider": "comfyui", "model": request.model or "workflow", "prompt_id": prompt_id, "history": history}
            view = await client.get(
                f"{base_url}/view",
                params={
                    "filename": output_ref.get("filename"),
                    "subfolder": output_ref.get("subfolder", ""),
                    "type": output_ref.get("type", "output"),
                },
            )
            view.raise_for_status()
            content_type = view.headers.get("content-type") or self._content_type_for_filename(str(output_ref.get("filename") or ""))
            encoded = base64.b64encode(view.content).decode("ascii")
            payload_key = "video_base64" if kind == "video" else "image_base64"
            return {
                "provider": "comfyui",
                "model": request.model or "workflow",
                "prompt_id": prompt_id,
                payload_key: encoded,
                "content_type": content_type,
                "history": {"outputs": history.get("outputs", {})},
            }

    def _comfyui_workflow_path(self, kind: str) -> Path | None:
        if kind == "video":
            return self.settings.comfyui_video_workflow_path
        return self.settings.comfyui_image_workflow_path or self.settings.comfyui_workflow_path

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

    def _first_comfyui_output(self, history: dict[str, Any], kind: str) -> dict[str, Any] | None:
        preferred_extensions = {
            "image": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
            "video": {".mp4", ".webm", ".mov", ".gif"},
        }.get(kind, set())
        outputs = history.get("outputs")
        if not isinstance(outputs, dict):
            return None
        for output in outputs.values():
            if not isinstance(output, dict):
                continue
            for key in ("videos", "gifs", "images", "files"):
                files = output.get(key)
                if not isinstance(files, list):
                    continue
                for item in files:
                    if not isinstance(item, dict):
                        continue
                    filename = str(item.get("filename") or "")
                    if not preferred_extensions or Path(filename).suffix.lower() in preferred_extensions:
                        return item
        return None

    def _local_media_command(self, kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        command = {
            "image": self.settings.local_image_command,
            "audio": self.settings.local_audio_command,
            "video": self.settings.local_video_command,
        }.get(kind)
        if not command:
            raise ValueError(f"AI_OS_LOCAL_{kind.upper()}_COMMAND is not configured.")

        output_extension = self._local_extension(kind)
        content_type = self._content_type_for_extension(output_extension)
        temp_root = self.settings.resolved_temp_dir()
        temp_root.mkdir(parents=True, exist_ok=True)
        work_dir = self.settings.local_media_work_dir or temp_root
        work_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as tmp:
            tmp_path = Path(tmp)
            output_path = tmp_path / f"output{output_extension}"
            prompt_path = tmp_path / "prompt.txt"
            text_path = tmp_path / "text.txt"
            prompt_path.write_text(request.prompt or "", encoding="utf-8")
            text_path.write_text(request.text or "", encoding="utf-8")
            env = os.environ.copy()
            env.update(
                {
                    "AI_OS_MEDIA_KIND": kind,
                    "AI_OS_MEDIA_PROMPT": request.prompt or "",
                    "AI_OS_MEDIA_TEXT": request.text or "",
                    "AI_OS_MEDIA_PROMPT_FILE": str(prompt_path),
                    "AI_OS_MEDIA_TEXT_FILE": str(text_path),
                    "AI_OS_MEDIA_OUTPUT": str(output_path),
                    "AI_OS_MEDIA_TEMP_DIR": str(tmp_path),
                }
            )
            self._write_optional_input(tmp_path, env, "image", request.image_base64, request.filename)
            self._write_optional_input(tmp_path, env, "audio", request.audio_base64, request.filename)
            self._write_optional_input(tmp_path, env, "video", request.video_base64, request.filename)
            completed = subprocess.run(
                command,
                shell=True,
                cwd=str(work_dir),
                env=env,
                capture_output=True,
                text=True,
                timeout=self.settings.local_media_timeout_s,
                check=False,
            )
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout or "Local media command failed.").strip()
                raise RuntimeError(detail[:2000])
            result = self._local_command_result(completed.stdout, output_path, kind, content_type)
            result.setdefault("stdout", completed.stdout[-2000:])
            result.setdefault("stderr", completed.stderr[-2000:])
            return result

    def _write_optional_input(self, tmp_path: Path, env: dict[str, str], kind: str, payload: str | None, filename: str | None) -> None:
        if not payload:
            return
        suffix = Path(filename or f"input.{kind}").suffix or ".bin"
        path = tmp_path / f"input_{kind}{suffix}"
        path.write_bytes(base64.b64decode(payload))
        env[f"AI_OS_MEDIA_INPUT_{kind.upper()}"] = str(path)

    def _local_command_result(self, stdout: str, output_path: Path, kind: str, content_type: str) -> dict[str, Any]:
        parsed = self._parse_command_json(stdout)
        if isinstance(parsed, dict):
            if any(key in parsed for key in ("image_base64", "audio_base64", "video_base64")):
                parsed.setdefault("provider", f"local-{kind}")
                parsed.setdefault("content_type", content_type)
                return parsed
            output_from_json = parsed.get("output_path")
            if isinstance(output_from_json, str) and output_from_json:
                output_path = Path(output_from_json)
        if not output_path.exists():
            raise RuntimeError(f"Local media command completed but did not create {output_path}.")
        payload_key = f"{kind}_base64"
        return {
            "provider": f"local-{kind}",
            "model": "local-command",
            "content_type": self._content_type_for_filename(str(output_path)) or content_type,
            payload_key: base64.b64encode(output_path.read_bytes()).decode("ascii"),
            "output_path": str(output_path),
        }

    def _parse_command_json(self, text: str) -> dict[str, Any] | None:
        stripped = text.strip()
        if not stripped:
            return None
        try:
            value = json.loads(stripped)
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            return None

    def _local_extension(self, kind: str) -> str:
        raw = {
            "image": self.settings.local_image_extension,
            "audio": self.settings.local_audio_extension,
            "video": self.settings.local_video_extension,
        }[kind]
        extension = raw.strip().lower()
        if not extension.startswith("."):
            extension = f".{extension}"
        allowed = {
            "image": {".png", ".jpg", ".jpeg", ".webp"},
            "audio": {".wav", ".mp3", ".flac", ".ogg"},
            "video": {".mp4", ".webm", ".mov", ".gif"},
        }[kind]
        fallback = {"image": ".png", "audio": ".wav", "video": ".mp4"}[kind]
        return extension if extension in allowed else fallback

    def _content_type_for_filename(self, filename: str) -> str:
        return self._content_type_for_extension(Path(filename).suffix.lower())

    def _content_type_for_extension(self, extension: str) -> str:
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".flac": "audio/flac",
            ".ogg": "audio/ogg",
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
        }.get(extension.lower(), "application/octet-stream")

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
                if key not in {"image_base64", "audio_base64", "video_base64"}
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
        elif isinstance(result.get("video_base64"), str):
            payload = result["video_base64"]
            extension = {
                "video/webm": ".webm",
                "video/quicktime": ".mov",
                "image/gif": ".gif",
            }.get(content_type or "", ".mp4")
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
