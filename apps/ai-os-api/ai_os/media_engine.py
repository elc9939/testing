from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import random
import struct
import wave
from dataclasses import dataclass
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from .config import Settings
from .models import MultimodalInvokeRequest


@dataclass
class MediaPlan:
    prompt: str
    palette: list[str]
    mood: str
    motion: str
    tempo_bpm: int
    scale: list[int]
    seed: int


class BuiltinMediaEngine:
    provider_image = "builtin-image"
    provider_audio = "builtin-audio"
    provider_video = "builtin-video"
    model_label = "ollama-directed-local-renderer"

    def __init__(self, settings: Settings):
        self.settings = settings

    async def invoke(self, kind: str, request: MultimodalInvokeRequest) -> dict[str, Any]:
        prompt = request.prompt or request.text or f"Generate a {kind} artifact."
        plan = await self._plan(prompt, kind)
        if kind == "image":
            return self._image(plan, request)
        if kind == "audio":
            return self._audio(plan, request)
        if kind == "video":
            return self._video(plan, request)
        raise ValueError(f"Builtin media engine does not support kind={kind!r}.")

    async def _plan(self, prompt: str, kind: str) -> MediaPlan:
        seed = int(hashlib.sha256(f"{kind}:{prompt}".encode("utf-8")).hexdigest()[:12], 16)
        fallback = self._fallback_plan(prompt, seed)
        instruction = (
            "Return compact JSON only for a local procedural media renderer. "
            "Use this schema: palette array of 4 hex colors, mood string, motion string, "
            "tempo_bpm integer 70-150, scale array of 5 MIDI intervals from 0-12. "
            f"Media kind: {kind}. Prompt: {prompt}"
        )
        try:
            async with httpx.AsyncClient(timeout=min(self.settings.ollama_timeout_s, 30.0)) as client:
                response = await client.post(
                    f"{self.settings.ollama_base_url.rstrip('/')}/api/generate",
                    json={
                        "model": self.settings.ollama_chat_model,
                        "prompt": instruction,
                        "stream": False,
                        "format": "json",
                        "options": {"num_ctx": self.settings.ollama_context_tokens, "num_predict": 220},
                    },
                )
                response.raise_for_status()
                text = str(response.json().get("response") or "")
            parsed = json.loads(text)
            return MediaPlan(
                prompt=prompt,
                palette=self._palette(parsed.get("palette"), fallback.palette),
                mood=str(parsed.get("mood") or fallback.mood)[:80],
                motion=str(parsed.get("motion") or fallback.motion)[:80],
                tempo_bpm=max(70, min(150, int(parsed.get("tempo_bpm") or fallback.tempo_bpm))),
                scale=self._scale(parsed.get("scale"), fallback.scale),
                seed=seed,
            )
        except Exception:
            return fallback

    def _fallback_plan(self, prompt: str, seed: int) -> MediaPlan:
        rng = random.Random(seed)
        palettes = [
            ["#101820", "#2f6f9f", "#8fd3ff", "#f5f7fa"],
            ["#18151f", "#6050dc", "#b8a1ff", "#f2f0ff"],
            ["#111827", "#1d4ed8", "#22d3ee", "#f8fafc"],
            ["#171717", "#0ea5e9", "#a78bfa", "#fafafa"],
        ]
        scales = [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 5, 7, 11], [0, 4, 6, 7, 11]]
        return MediaPlan(
            prompt=prompt,
            palette=rng.choice(palettes),
            mood=rng.choice(["focused", "luminous", "kinetic", "quiet", "technical"]),
            motion=rng.choice(["orbital", "wave", "pulse", "drift", "cascade"]),
            tempo_bpm=rng.randint(82, 132),
            scale=rng.choice(scales),
            seed=seed,
        )

    def _palette(self, value: Any, fallback: list[str]) -> list[str]:
        if isinstance(value, list):
            colors = [str(item) for item in value if isinstance(item, str) and self._is_hex(item)]
            if len(colors) >= 2:
                return (colors + fallback)[:4]
        return fallback

    def _scale(self, value: Any, fallback: list[int]) -> list[int]:
        if isinstance(value, list):
            notes = []
            for item in value:
                try:
                    notes.append(max(0, min(12, int(item))))
                except Exception:
                    continue
            if notes:
                return notes[:8]
        return fallback

    def _image(self, plan: MediaPlan, request: MultimodalInvokeRequest) -> dict[str, Any]:
        width = self._int_option(request, "width", self.settings.builtin_media_width, 256, 2048)
        height = self._int_option(request, "height", self.settings.builtin_media_height, 256, 2048)
        image = self._render_frame(plan, width, height, 0.0)
        return {
            "provider": self.provider_image,
            "model": self.model_label,
            "content_type": "image/png",
            "image_base64": self._encode_image(image, "PNG"),
            "plan": self._plan_metadata(plan),
        }

    def _video(self, plan: MediaPlan, request: MultimodalInvokeRequest) -> dict[str, Any]:
        width = self._int_option(request, "width", min(self.settings.builtin_media_width, 768), 256, 1024)
        height = self._int_option(request, "height", min(self.settings.builtin_media_height, 432), 256, 768)
        frames_count = self._int_option(request, "frames", self.settings.builtin_video_frames, 4, 180)
        frames = [self._render_frame(plan, width, height, index / max(1, frames_count - 1)) for index in range(frames_count)]
        output = io.BytesIO()
        frames[0].save(
            output,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=max(40, int(60_000 / (plan.tempo_bpm * 2))),
            loop=0,
            optimize=True,
        )
        return {
            "provider": self.provider_video,
            "model": self.model_label,
            "content_type": "image/gif",
            "video_base64": base64.b64encode(output.getvalue()).decode("ascii"),
            "plan": self._plan_metadata(plan),
        }

    def _audio(self, plan: MediaPlan, request: MultimodalInvokeRequest) -> dict[str, Any]:
        duration = self._float_option(request, "duration_s", self.settings.builtin_audio_duration_s, 1.0, 60.0)
        sample_rate = 22_050
        frames = int(sample_rate * duration)
        rng = random.Random(plan.seed)
        base_freq = 110.0 * (2 ** (rng.randint(0, 7) / 12))
        beat = 60.0 / plan.tempo_bpm
        samples = bytearray()
        for index in range(frames):
            t = index / sample_rate
            step = int(t / beat) % len(plan.scale)
            interval = plan.scale[step]
            freq = base_freq * (2 ** (interval / 12))
            env = 0.55 + 0.45 * math.sin(math.tau * (t / beat % 1))
            wave_value = (
                math.sin(math.tau * freq * t)
                + 0.42 * math.sin(math.tau * freq * 2.0 * t + 0.3)
                + 0.18 * math.sin(math.tau * freq * 0.5 * t + 1.4)
            ) / 1.6
            mod = 0.72 + 0.28 * math.sin(math.tau * t * (0.08 + (plan.seed % 5) * 0.03))
            value = max(-1.0, min(1.0, wave_value * env * mod * 0.55))
            packed = struct.pack("<h", int(value * 32767))
            samples.extend(packed)
            samples.extend(packed)
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(bytes(samples))
        return {
            "provider": self.provider_audio,
            "model": self.model_label,
            "content_type": "audio/wav",
            "audio_base64": base64.b64encode(output.getvalue()).decode("ascii"),
            "plan": self._plan_metadata(plan),
        }

    def _render_frame(self, plan: MediaPlan, width: int, height: int, phase: float) -> Image.Image:
        rng = random.Random(plan.seed)
        bg = Image.new("RGB", (width, height), plan.palette[0])
        draw = ImageDraw.Draw(bg, "RGBA")
        for y in range(height):
            mix = y / max(1, height - 1)
            color = self._mix(plan.palette[0], plan.palette[1], mix)
            draw.line((0, y, width, y), fill=(*color, 255))

        field = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        layer = ImageDraw.Draw(field, "RGBA")
        for index in range(18):
            angle = math.tau * (rng.random() + phase * (0.2 + rng.random() * 0.9))
            radius = min(width, height) * (0.08 + rng.random() * 0.42)
            cx = width * (0.5 + math.cos(angle) * radius / width)
            cy = height * (0.5 + math.sin(angle * 0.83) * radius / height)
            size = min(width, height) * (0.04 + rng.random() * 0.16)
            color = self._rgba(plan.palette[2 + index % max(1, len(plan.palette) - 2)], 58 + index * 6)
            if index % 3 == 0:
                layer.ellipse((cx - size, cy - size, cx + size, cy + size), fill=color)
            elif index % 3 == 1:
                layer.rounded_rectangle((cx - size, cy - size * 0.65, cx + size, cy + size * 0.65), radius=18, fill=color)
            else:
                layer.line((cx - size, cy, cx + size, cy + math.sin(angle) * size), fill=color, width=max(2, int(size / 12)))

        for index in range(10):
            y = height * (0.15 + index * 0.075)
            amp = height * (0.014 + (index % 4) * 0.009)
            points = []
            for x in range(0, width + 8, 8):
                value = math.sin((x / width) * math.tau * (1.2 + index * 0.13) + phase * math.tau + index)
                points.append((x, y + amp * value))
            layer.line(points, fill=self._rgba(plan.palette[(index + 1) % len(plan.palette)], 58), width=2)

        field = field.filter(ImageFilter.GaussianBlur(radius=0.6))
        bg = Image.alpha_composite(bg.convert("RGBA"), field)
        accent = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        accent_draw = ImageDraw.Draw(accent, "RGBA")
        for index, word in enumerate(self._keywords(plan.prompt)[:7]):
            x = 24 + (index % 4) * width * 0.23
            y = height - 42 - (index // 4) * 34
            accent_draw.rounded_rectangle((x - 8, y - 7, x + 12 + len(word) * 8, y + 18), radius=8, fill=(0, 0, 0, 72))
            accent_draw.text((x, y), word[:18], fill=self._rgba(plan.palette[-1], 230))
        bg = Image.alpha_composite(bg, accent)
        if phase:
            shifted = ImageChops.offset(bg, int(math.sin(phase * math.tau) * 8), int(math.cos(phase * math.tau) * 4))
            bg = Image.blend(bg, shifted, 0.18)
        return bg.convert("RGB")

    def _int_option(self, request: MultimodalInvokeRequest, key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(request.options.get(key) or default)
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

    def _float_option(
        self,
        request: MultimodalInvokeRequest,
        key: str,
        default: float,
        minimum: float,
        maximum: float,
    ) -> float:
        try:
            value = float(request.options.get(key) or default)
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

    def _keywords(self, prompt: str) -> list[str]:
        words = [word.strip(".,!?;:()[]{}\"'").lower() for word in prompt.split()]
        stop = {"the", "and", "for", "with", "from", "into", "that", "this", "make", "generate", "image", "video", "audio"}
        return [word for word in words if len(word) > 2 and word not in stop] or ["local", "ai", "media"]

    def _encode_image(self, image: Image.Image, fmt: str) -> str:
        output = io.BytesIO()
        image.save(output, format=fmt)
        return base64.b64encode(output.getvalue()).decode("ascii")

    def _mix(self, left: str, right: str, amount: float) -> tuple[int, int, int]:
        l = self._rgb(left)
        r = self._rgb(right)
        return tuple(int(l[i] + (r[i] - l[i]) * amount) for i in range(3))

    def _rgb(self, color: str) -> tuple[int, int, int]:
        color = color if self._is_hex(color) else "#000000"
        return (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))

    def _rgba(self, color: str, alpha: int) -> tuple[int, int, int, int]:
        return (*self._rgb(color), max(0, min(255, alpha)))

    def _is_hex(self, value: str) -> bool:
        if len(value) != 7 or not value.startswith("#"):
            return False
        try:
            int(value[1:], 16)
            return True
        except ValueError:
            return False

    def _plan_metadata(self, plan: MediaPlan) -> dict[str, Any]:
        return {
            "palette": plan.palette,
            "mood": plan.mood,
            "motion": plan.motion,
            "tempo_bpm": plan.tempo_bpm,
            "scale": plan.scale,
            "seed": plan.seed,
        }
