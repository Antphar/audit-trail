# /// script
# dependencies = [
#   "numpy>=1.26",
#   "playwright>=1.40",
#   "rich>=13.0",
#   "torch>=2.2",
# ]
# ///
"""Train a Dueling Double DQN policy for Turbo Kart Dash.

Run with uv:
  uv run train_dqn.py --random-map --random-character --with-opponents --with-items --self-play

The exported JSON loads in-browser and is used by DqnAIKart for AI opponents.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import math
import random
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rl_common as common
import torch
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn, TimeRemainingColumn
from rich.table import Table

BATTLE_DEFAULT_ANCHORS = "dqn-arena-v5,dqn-arena"
RACE_DEFAULT_ANCHORS = "dqn-15act-h64-tanh-ortho-300k"
CHARACTER_IDS = ("anton", "artur", "rissal", "pia", "florian")
MATCHUP_ELO_K = 16.0


@dataclass
class Transition:
    obs: np.ndarray
    action: int
    reward: float
    next_obs: np.ndarray
    done: bool


class ReplayBuffer:
    def __init__(self, capacity: int):
        self.data: deque[Transition] = deque(maxlen=capacity)

    def __len__(self) -> int:
        return len(self.data)

    def add(self, transition: Transition) -> None:
        self.data.append(transition)

    def sample(self, batch_size: int) -> tuple[torch.Tensor, ...]:
        batch = random.sample(self.data, batch_size)
        obs = torch.tensor(np.stack([t.obs for t in batch]), dtype=torch.float32)
        actions = torch.tensor([t.action for t in batch], dtype=torch.int64).unsqueeze(1)
        rewards = torch.tensor([t.reward for t in batch], dtype=torch.float32)
        next_obs = torch.tensor(np.stack([t.next_obs for t in batch]), dtype=torch.float32)
        dones = torch.tensor([t.done for t in batch], dtype=torch.float32)
        return obs, actions, rewards, next_obs, dones


class _L2Norm(torch.nn.Module):
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x / (x.norm(dim=-1, keepdim=True) + 1e-8)


class DQN(torch.nn.Module):
    """Dueling DQN: shared trunk → separate value and advantage streams."""

    def __init__(
        self,
        obs_dim: int,
        action_dim: int,
        hidden: int = 128,
        activation: str = "tanh",
        layer_norm: bool = False,
        l2_norm: bool = False,
        orthogonal_init: bool = False,
        weight_norm: bool = False,
        mean_expansion_k: float = 0.0,
        advantage_centering: bool = True,
    ):
        super().__init__()
        activation = activation.lower()
        if activation not in {"tanh", "gelu", "relu"}:
            raise ValueError(f"Unsupported activation: {activation}")
        self.activation_name = activation
        self.layer_norm_enabled = layer_norm
        self.l2_norm_enabled = l2_norm
        self.mean_expansion_k = float(mean_expansion_k)
        self.advantage_centering = advantage_centering
        layers: list[torch.nn.Module] = []
        in_dim = obs_dim
        for _ in range(2):
            layers.append(torch.nn.Linear(in_dim, hidden))
            if layer_norm:
                layers.append(torch.nn.LayerNorm(hidden))
            if activation == "gelu":
                layers.append(torch.nn.GELU())
            elif activation == "relu":
                layers.append(torch.nn.ReLU())
            else:
                layers.append(torch.nn.Tanh())
            if l2_norm:
                layers.append(_L2Norm())
            in_dim = hidden
        self.trunk = torch.nn.Sequential(*layers)
        self.value_head = torch.nn.Linear(hidden, 1)
        self.advantage_head = torch.nn.Linear(hidden, action_dim)
        self._weight_norm = weight_norm
        if orthogonal_init:
            self._init_weights()
        if weight_norm:
            self._project_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, torch.nn.Linear):
                torch.nn.init.orthogonal_(m.weight, gain=math.sqrt(2))
                torch.nn.init.zeros_(m.bias)
        torch.nn.init.orthogonal_(self.value_head.weight, gain=1.0)
        torch.nn.init.orthogonal_(self.advantage_head.weight, gain=0.01)

    @torch.no_grad()
    def _project_weights(self) -> None:
        for m in self.trunk.modules():
            if isinstance(m, torch.nn.Linear):
                norm = m.weight.data.norm(p=2)
                if norm > 0:
                    m.weight.data.div_(norm)

    def forward_components(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        h = self.trunk(x)
        v = self.value_head(h)
        a = self.advantage_head(h)
        residual = a - a.mean(dim=-1, keepdim=True) if self.advantage_centering else a
        q = v + residual
        if self.mean_expansion_k <= 0:
            return q, v, a
        q_mean = q.mean(dim=-1, keepdim=True)
        return q - q_mean + (self.mean_expansion_k + 1.0) * q_mean, v, a

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        q, _, _ = self.forward_components(x)
        return q


class TurboKartEnv:
    def __init__(
        self,
        page: Any,
        index_path: Path,
        map_id: str,
        character: str,
        frames: int,
        solo: bool,
        no_items: bool,
        no_hazards: bool,
        frame_stack: int = 1,
        frame_skip: int = 4,
        opponent_models: list[dict[str, Any]] | None = None,
    ):
        self.page = page
        flags = [
            "headless=1",
            "external=1",
            f"map={map_id}",
            f"char={character}",
            f"frames={frames}",
            f"solo={1 if solo else 0}",
            f"noItems={1 if no_items else 0}",
            f"noHazards={1 if no_hazards else 0}",
        ]
        self.url = index_path.resolve().as_uri() + "?" + "&".join(flags)
        self.map_id = map_id
        self.character = character
        self.frames = frames
        self.solo = solo
        self.no_items = no_items
        self.no_hazards = no_hazards
        self.frame_stack = max(1, int(frame_stack))
        self.frame_skip = max(1, int(frame_skip))
        self.opponent_models = opponent_models or []
        self.obs_keys: list[str] = []
        self._base_keys: list[str] = []
        self.actions: list[dict[str, Any]] = []
        self._frames: deque[np.ndarray] = deque(maxlen=self.frame_stack)

    _SHALLOW_STACK_PREFIXES = ("kartRay", "hazardRay", "pickupRay", "boosterRay")
    _SHALLOW_STACK_MAX_LAG = 0

    def _stack_keys(self, keys: list[str]) -> list[str]:
        if self.frame_stack <= 1:
            return keys
        stacked = []
        for lag in range(self.frame_stack):
            suffix = "" if lag == 0 else f"@-{lag}"
            for key in keys:
                if lag > self._SHALLOW_STACK_MAX_LAG and any(
                    key.startswith(p) for p in self._SHALLOW_STACK_PREFIXES
                ):
                    continue
                stacked.append(f"{key}{suffix}")
        return stacked

    def _stack_obs(self, obs: np.ndarray, reset: bool = False) -> np.ndarray:
        self.last_base_obs = obs.copy()
        if reset or not self._frames:
            self._frames.clear()
            for _ in range(self.frame_stack):
                self._frames.append(obs.copy())
        else:
            self._frames.appendleft(obs.copy())
            while len(self._frames) < self.frame_stack:
                self._frames.append(obs.copy())
        if self.frame_stack <= 1:
            return obs
        if not hasattr(self, "_stack_mask"):
            self._build_stack_mask()
        full = np.concatenate(list(self._frames)).astype(np.float32)
        return full[self._stack_mask] if self._stack_mask is not None else full

    def _build_stack_mask(self) -> None:
        if self.frame_stack <= 1 or not self._base_keys:
            self._stack_mask = None
            return
        n_base = len(self._base_keys)
        keep = []
        for lag in range(self.frame_stack):
            for i, key in enumerate(self._base_keys):
                if lag > self._SHALLOW_STACK_MAX_LAG and any(
                    key.startswith(p) for p in self._SHALLOW_STACK_PREFIXES
                ):
                    continue
                keep.append(lag * n_base + i)
        self._stack_mask = np.array(keep, dtype=np.intp)

    def load(self) -> None:
        self.page.goto(self.url, wait_until="load")
        ready = self.page.evaluate("window.__HEADLESS_READY__")
        if not ready:
            raise RuntimeError("Headless RL API did not initialize")

    def reset(self) -> np.ndarray:
        return self.reset_with()

    def reset_with(
        self,
        *,
        map_id: str | None = None,
        character: str | None = None,
        opponent_models: list[dict[str, Any]] | None = None,
    ) -> np.ndarray:
        if map_id is not None:
            self.map_id = map_id
        if character is not None:
            self.character = character
        if opponent_models is not None:
            self.opponent_models = opponent_models
        result = self.page.evaluate(
            """(cfg) => window.rlReset(cfg)""",
            {
                "map": self.map_id,
                "character": self.character,
                "frames": self.frames,
                "solo": self.solo,
                "noItems": self.no_items,
                "noHazards": self.no_hazards,
                "frameSkip": self.frame_skip,
                "opponentModels": self.opponent_models,
            },
        )
        self._base_keys = result["obsKeys"]
        self.obs_keys = self._stack_keys(self._base_keys)
        self.actions = result["actions"]
        return self._stack_obs(np.asarray(result["obs"], dtype=np.float32), reset=True)

    def step(self, action: int) -> tuple[np.ndarray, float, bool, dict[str, Any]]:
        result = self.page.evaluate("(a) => window.rlStep(a)", int(action))
        obs = self._stack_obs(np.asarray(result["obs"], dtype=np.float32))
        reward = float(result["reward"])
        done = bool(result["done"])
        info = dict(result["info"])
        return obs, reward, done, info


def smoothgrad_attribution(
    model: DQN,
    buffer: ReplayBuffer,
    obs_keys: list[str],
    *,
    n_samples: int = 200,
    n_smooth: int = 30,
    noise_std: float = 0.1,
) -> dict[str, float]:
    if len(buffer) < n_samples:
        return {}
    batch = random.sample(buffer.data, n_samples)
    obs_batch = torch.tensor(np.stack([t.obs for t in batch]), dtype=torch.float32)
    obs_batch.requires_grad_(True)

    attributions = torch.zeros(obs_batch.shape[1])
    for _ in range(n_smooth):
        noisy = (obs_batch + torch.randn_like(obs_batch) * noise_std).detach()
        noisy.requires_grad_(True)
        q_values = model(noisy)
        best_q = q_values.max(dim=1).values.sum()
        best_q.backward()
        if noisy.grad is not None:
            attributions += noisy.grad.abs().mean(dim=0).detach()
        model.zero_grad()

    attributions /= max(1, n_smooth)
    result: dict[str, float] = {}
    for i, score in enumerate(attributions.tolist()):
        key = obs_keys[i] if i < len(obs_keys) else f"obs_{i}"
        result[key] = round(score, 6)
    return dict(sorted(result.items(), key=lambda kv: -kv[1]))


def print_attribution_table(
    console: Console,
    title: str,
    attribution: dict[str, float],
    top_n: int = 15,
    bottom_n: int = 15,
) -> None:
    if not attribution:
        return
    sorted_items = list(attribution.items())
    max_val = max(v for _, v in sorted_items) if sorted_items else 1
    table = Table(title=title)
    table.add_column("Feature", style="cyan")
    table.add_column("Attention", justify="right", style="yellow")
    table.add_column("Bar", style="green")
    top_items = sorted_items[:top_n]
    bottom_items = sorted_items[-bottom_n:] if len(sorted_items) > top_n + bottom_n else []
    for key, score in top_items:
        bar_len = int(24 * score / max(max_val, 1e-9))
        table.add_row(key, f"{score:.4f}", "█" * bar_len)
    if bottom_items:
        table.add_row("···", "", "", style="dim")
        for key, score in bottom_items:
            bar_len = int(24 * score / max(max_val, 1e-9))
            table.add_row(key, f"{score:.4f}", "█" * bar_len, style="dim")
    total = len(sorted_items)
    console.print(table)
    console.print(
        f"  [dim]{total} features total · showing top {min(top_n, total)} "
        f"+ bottom {min(bottom_n, len(bottom_items))}[/dim]"
    )


def epsilon_by_step(step: int, start: float, end: float, decay_steps: int) -> float:
    t = min(1.0, step / max(1, decay_steps))
    return start + (end - start) * t


def emit_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def format_float(value: float | None, digits: int = 3) -> str:
    if value is None:
        return "-"
    return f"{value:.{digits}f}"


def print_metrics_table(console: Console, title: str, metrics: dict[str, Any]) -> None:
    table = Table(title=title)
    table.add_column("Metric", style="cyan")
    table.add_column("Value", justify="right", style="green")
    for key, value in metrics.items():
        if isinstance(value, float):
            table.add_row(key, format_float(value, 4))
        else:
            table.add_row(key, str(value))
    console.print(table)


def print_eval_report(
    console: Console,
    title: str,
    report: dict[str, Any],
    reference: dict[str, dict[str, float]],
) -> None:
    table = Table(title=title)
    table.add_column("Track", style="cyan")
    table.add_column("Solo F", justify="right", style="green")
    table.add_column("Solo R", justify="right")
    table.add_column("Classic F", justify="right", style="green")
    table.add_column("Classic R", justify="right")
    table.add_column("Classic Laps", justify="right")
    table.add_column("Classic Win", justify="right", style="bold green")
    table.add_column("Classic Winner", justify="right")
    table.add_column("Ref R", justify="right", style="magenta")
    table.add_column("Ref F", justify="right", style="magenta")
    for track, metrics in report.get("tracks", {}).items():
        solo = metrics.get("solo", {})
        classic = metrics.get("classic", {})
        ref = reference.get(track, {})
        table.add_row(
            track,
            format_float(solo.get("finish_rate"), 2),
            format_float(solo.get("avg_reward"), 1),
            format_float(classic.get("finish_rate"), 2),
            format_float(classic.get("avg_reward"), 1),
            format_float(classic.get("avg_laps"), 2),
            format_float(classic.get("player_win_rate"), 2),
            ", ".join(f"{k}:{v}" for k, v in (classic.get("winner_chars") or {}).items()) or "-",
            format_float(ref.get("avg_reward"), 1),
            format_float(ref.get("finish_rate"), 2),
        )
    console.print(table)


def launch_chromium(playwright: Any, auto_install: bool) -> Any:
    try:
        return playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
    except PlaywrightError as exc:
        message = str(exc)
        missing_browser = "Executable doesn't exist" in message or "playwright install" in message
        if not missing_browser or not auto_install:
            if missing_browser:
                raise RuntimeError(
                    "Playwright is installed, but its Chromium browser is missing. "
                    "Run this from turbokart:\n\n"
                    "  uv run train_dqn.py --install-browser-only\n\n"
                    "Then rerun the trainer."
                ) from None
            raise

        print(json.dumps({"event": "browser_install", "command": "python -m playwright install chromium"}), flush=True)
        subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
        return playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])


def _serialize_linear(layer: torch.nn.Linear) -> dict[str, Any]:
    return {
        "weights": layer.weight.detach().cpu().numpy().astype(float).reshape(-1).tolist(),
        "biases": layer.bias.detach().cpu().numpy().astype(float).reshape(-1).tolist(),
    }


def _serialize_layernorm(layer: torch.nn.LayerNorm) -> dict[str, Any]:
    return {
        "weight": layer.weight.detach().cpu().numpy().astype(float).tolist(),
        "bias": layer.bias.detach().cpu().numpy().astype(float).tolist(),
        "eps": layer.eps,
    }


def build_dqn_payload(
    model: DQN,
    obs_keys: list[str],
    actions: list[dict[str, Any]],
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trunk_layers: list[dict[str, Any]] = []
    i = 0
    modules = list(model.trunk)
    while i < len(modules):
        m = modules[i]
        if isinstance(m, torch.nn.Linear):
            d = _serialize_linear(m)
            if i + 1 < len(modules) and isinstance(modules[i + 1], torch.nn.LayerNorm):
                d["layernorm"] = _serialize_layernorm(modules[i + 1])
                i += 1
            if i + 1 < len(modules):
                act = modules[i + 1]
                if isinstance(act, torch.nn.GELU):
                    d["activation"] = "gelu"
                elif isinstance(act, torch.nn.Tanh):
                    d["activation"] = "tanh"
                elif isinstance(act, torch.nn.ReLU):
                    d["activation"] = "relu"
                else:
                    d["activation"] = "tanh"
                i += 1
            else:
                d["activation"] = "linear"
            trunk_layers.append(d)
        i += 1

    return {
        "type": "dqn",
        "format": "turbo-kart-headless-dqn-v2",
        "architecture": "dueling",
        "observationKeys": obs_keys,
        "actions": actions,
        "trunk": trunk_layers,
        "value_head": {**_serialize_linear(model.value_head), "activation": "linear"},
        "advantage_head": {**_serialize_linear(model.advantage_head), "activation": "linear"},
        "advantageCentering": model.advantage_centering,
        "meanExpansionK": model.mean_expansion_k,
        "meta": meta or {},
    }


def build_compact_dqn_policy(
    model: DQN,
    obs_keys: list[str],
    actions: list[dict[str, Any]],
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Serialize DQN parameters as one little-endian float32 base64 buffer."""
    arrays: list[np.ndarray] = []
    offset = 0

    def _append_tensor(tensor: torch.Tensor) -> dict[str, Any]:
        nonlocal offset
        values = np.asarray(
            tensor.detach().cpu().numpy(),
            dtype=np.dtype("<f4"),
        ).reshape(-1)
        descriptor = {
            "offset": offset,
            "length": int(values.size),
            "shape": list(tensor.shape),
        }
        arrays.append(values)
        offset += int(values.size)
        return descriptor

    def _linear_descriptor(layer: torch.nn.Linear) -> dict[str, Any]:
        return {
            "weights": _append_tensor(layer.weight),
            "biases": _append_tensor(layer.bias),
        }

    trunk_layers: list[dict[str, Any]] = []
    modules = list(model.trunk)
    i = 0
    while i < len(modules):
        module = modules[i]
        if not isinstance(module, torch.nn.Linear):
            i += 1
            continue
        descriptor = _linear_descriptor(module)
        if i + 1 < len(modules) and isinstance(modules[i + 1], torch.nn.LayerNorm):
            layernorm = modules[i + 1]
            descriptor["layernorm"] = {
                "weight": _append_tensor(layernorm.weight),
                "bias": _append_tensor(layernorm.bias),
                "eps": layernorm.eps,
            }
            i += 1
        if i + 1 < len(modules):
            activation = modules[i + 1]
            if isinstance(activation, torch.nn.GELU):
                descriptor["activation"] = "gelu"
            elif isinstance(activation, torch.nn.ReLU):
                descriptor["activation"] = "relu"
            else:
                descriptor["activation"] = "tanh"
            i += 1
        else:
            descriptor["activation"] = "linear"
        trunk_layers.append(descriptor)
        i += 1

    value_head = {**_linear_descriptor(model.value_head), "activation": "linear"}
    advantage_head = {
        **_linear_descriptor(model.advantage_head),
        "activation": "linear",
    }
    flat = np.concatenate(arrays).astype("<f4", copy=False) if arrays else np.empty(0, dtype="<f4")
    return {
        "type": "dqn",
        "format": "turbo-kart-headless-dqn-compact-v1",
        "architecture": "dueling",
        "encoding": "base64-f32le",
        "floatCount": int(flat.size),
        "weightsBase64": base64.b64encode(flat.tobytes()).decode("ascii"),
        "observationKeys": obs_keys,
        "actions": actions,
        "trunk": trunk_layers,
        "value_head": value_head,
        "advantage_head": advantage_head,
        "advantageCentering": model.advantage_centering,
        "meanExpansionK": model.mean_expansion_k,
        "meta": meta or {},
    }


def record_replay_transition(
    buffer: common.FrameReplayBuffer,
    base_obs: np.ndarray,
    action: int,
    reward: float,
    done: bool,
) -> None:
    """Store the explicit post-step base frame for one transition."""
    buffer.add(base_obs, action, reward, done)


def export_dqn_json(
    model: DQN,
    obs_keys: list[str],
    actions: list[dict[str, Any]],
    out_path: Path,
    meta: dict[str, Any],
    manifest_path: Path | None = None,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_dqn_payload(model, obs_keys, actions, meta=meta)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if manifest_path is not None:
        common.update_model_manifest(manifest_path, out_path, payload)


def rollout_seed(base_seed: int, batch_start_step: int) -> int:
    """Deterministic rollout PRNG seed from base seed and global batch-start step."""
    return (int(base_seed) & 0xFFFFFFFF) ^ ((int(batch_start_step) * 2654435761) & 0xFFFFFFFF)


def flip_duel_score(score: float) -> float:
    """Convert a duel score from player-kart perspective to the opponent's perspective."""
    if score >= 1.0:
        return 0.0
    if score <= 0.0:
        return 1.0
    return 0.5


def live_model_duel_payload(model: DQN, env: Any) -> dict[str, Any]:
    return build_dqn_payload(model, env.obs_keys, env.actions)


def update_model_manifest(manifest_path: Path, model_path: Path, payload: dict[str, Any]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    else:
        manifest = {}
    models = manifest.get("models")
    if not isinstance(models, list):
        models = []
    model_id = payload["meta"].get("id") or model_path.stem
    try:
        rel_path = model_path.relative_to(manifest_path.parent.parent).as_posix()
    except ValueError:
        rel_path = model_path.as_posix()
    entry = {
        "id": model_id,
        "name": payload["meta"].get("name") or model_id,
        "path": rel_path,
        "map": payload["meta"].get("map"),
        "character": payload["meta"].get("character"),
        "format": payload.get("format"),
        "observationKeyCount": len(payload.get("observationKeys", [])),
        "actionCount": len(payload.get("actions", [])),
        "metrics": payload["meta"].get("metrics", {}),
        "eval": payload["meta"].get("eval", {}),
        "frameStack": payload["meta"].get("frameStack", 1),
        "frameSkip": payload["meta"].get("frameSkip", 1),
        "updatedAt": int(time.time()),
    }
    models = [m for m in models if m.get("id") != model_id]
    models.append(entry)
    manifest["models"] = sorted(models, key=lambda m: m.get("updatedAt", 0), reverse=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def parse_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def load_league_models(manifest_path: Path, limit: int | None = None) -> list[dict[str, Any]]:
    if not manifest_path.exists():
        return []
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    root = manifest_path.parent.parent
    models = manifest.get("models", [])
    loaded = []
    for idx, entry in enumerate(models):
        path = entry.get("path")
        if not path:
            continue
        model_path = root / path
        if not model_path.exists():
            continue
        try:
            payload = json.loads(model_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if payload.get("type") != "dqn" or not payload.get("layers"):
            continue
        loaded.append({"entry": entry, "payload": payload, "rank": idx})
        if limit is not None and len(loaded) >= limit:
            break
    return loaded


def sample_league_opponents(args: argparse.Namespace, league: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not args.self_play or not league:
        return []
    opponents = []
    for _ in range(args.league_opponents):
        if random.random() < args.classic_opponent_prob:
            continue
        weights = []
        for item in league:
            updated = float(item["entry"].get("updatedAt", 0) or 0)
            rank_weight = math.exp(-item["rank"] / max(0.001, args.league_recency_tau))
            weights.append(max(0.0001, rank_weight * (1.0 + updated * 0.0)))
        chosen = random.choices(league, weights=weights, k=1)[0]
        opponents.append(chosen["payload"])
    return opponents


def load_anchor_models(
    manifest_path: Path,
    anchor_ids: list[str],
    *,
    console: Console | None = None,
) -> list[dict[str, Any]]:
    anchors: list[dict[str, Any]] = []
    if not manifest_path.exists():
        return anchors
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return anchors
    root = manifest_path.parent.parent
    by_id = {m.get("id"): m for m in manifest.get("models", []) if m.get("id")}
    for anchor_id in anchor_ids:
        entry = by_id.get(anchor_id)
        if not entry:
            if console:
                console.print(f"[yellow]Anchor model '{anchor_id}' not found in manifest; skipping.[/yellow]")
            continue
        path = entry.get("path")
        if not path:
            continue
        model_path = root / path
        if not model_path.exists():
            if console:
                console.print(f"[yellow]Anchor model file missing: {model_path}[/yellow]")
            continue
        try:
            payload = json.loads(model_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if payload.get("type") != "dqn":
            continue
        anchors.append({"name": anchor_id, "payload": payload})
    return anchors


def resolve_training_opponents(
    args: argparse.Namespace,
    *,
    is_battle: bool,
    league: list[dict[str, Any]],
    anchors: list[dict[str, Any]],
    checkpoint_pool: list[dict[str, Any]],
    total_slots: int = 4,
    rng: random.Random | None = None,
) -> tuple[list[dict[str, Any]], int | None]:
    if is_battle and args.self_play:
        opponent_models, classic_slots = common.sample_battle_opponents(
            anchors,
            checkpoint_pool,
            total_slots=total_slots,
            classic_prob=args.train_classic_prob,
            anchor_prob=args.train_anchor_prob,
            rng=rng,
        )
        return opponent_models, classic_slots
    if not is_battle and args.self_play and not args.race_league:
        opponent_models, classic_slots = common.sample_race_opponents(
            checkpoint_pool,
            total_slots=total_slots,
            classic_prob=args.race_classic_prob,
            rng=rng,
        )
        return opponent_models, classic_slots
    return common.sample_league_opponents(args, league), None


def battle_training_opponent_count(
    args: argparse.Namespace,
    step: int,
    curriculum_rng: random.Random,
) -> int | None:
    if args.mode != "battle" or not args.self_play:
        return None
    if args.battle_opponents is not None:
        return args.battle_opponents
    return common.resolve_battle_opponent_count(
        args.battle_opponent_curriculum_parsed,
        step,
        args.steps,
        curriculum_rng,
    )


def build_training_checkpoint_meta(
    args: argparse.Namespace,
    step: int,
    *,
    metrics: dict[str, Any] | None = None,
    eval_report: dict[str, Any] | None = None,
    reference_metrics: dict[str, Any] | None = None,
    attribution: dict[str, float] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "id": f"{args.model_id}-step-{step}",
        "name": f"{args.model_name} step {step}",
        "step": step,
        "mode": args.mode,
        "map": args.map,
        "character": args.character,
        "frameStack": args.frame_stack,
        "frameSkip": args.frame_skip,
        "nStep": args.n_step,
        "activation": args.activation,
        "layerNorm": args.layer_norm,
        "orthogonalInit": args.orthogonal_init,
        "meanExpansionK": args.mean_expansion_k,
        "rdq": args.rdq,
        "rdqBeta": args.rdq_beta if args.rdq else 0.0,
        "advantageCentering": not args.rdq,
        "battleOpponentCurriculum": args.battle_opponent_curriculum,
        "battleOpponentsFixed": args.battle_opponents,
        "rolloutBatchSize": args.rollout_batch_size,
        "rolloutPolicySyncSteps": args.rollout_policy_sync_steps,
    }
    if metrics is not None:
        meta["metrics"] = metrics
    if eval_report is not None:
        meta["eval"] = eval_report
    if reference_metrics is not None:
        meta["reference"] = reference_metrics
    if attribution:
        meta["attribution"] = attribution
    return meta


def export_training_checkpoint(
    q: DQN,
    env: Any,
    args: argparse.Namespace,
    step: int,
    checkpoint_pool: list[dict[str, Any]],
    *,
    checkpoints_exported: set[int],
    meta_overrides: dict[str, Any] | None = None,
) -> Path | None:
    if step in checkpoints_exported:
        return Path(args.checkpoint_dir) / f"{args.model_id}-step-{step}.json"
    checkpoint_path = Path(args.checkpoint_dir) / f"{args.model_id}-step-{step}.json"
    meta = build_training_checkpoint_meta(args, step)
    if meta_overrides:
        meta.update(meta_overrides)
    export_dqn_json(
        q,
        env.obs_keys,
        env.actions,
        checkpoint_path,
        meta,
        None,
    )
    checkpoints_exported.add(step)
    try:
        ckpt_payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        checkpoint_pool.append({"name": f"ckpt-{step}", "payload": ckpt_payload})
        checkpoint_pool[:] = checkpoint_pool[-args.checkpoint_pool_size :]
    except (OSError, json.JSONDecodeError):
        pass
    return checkpoint_path


RACE_DUEL_PROGRESS_EPS = 1e-4


@torch.no_grad()
def _score_battle_duel_episode(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    live_payload: dict[str, Any] | None,
    live_is_player: bool,
    seed: int | None = None,
) -> float:
    """Run one battle duel; return 1.0 win, 0.5 draw, 0.0 loss from player-kart perspective."""
    if live_is_player:
        opponent_models = [opponent_payload] if opponent_payload else []
        classic_opponent_slots = 0 if opponent_payload else 1
    else:
        opponent_models = [live_payload] if live_payload else []
        classic_opponent_slots = 0 if live_payload else 1
    reset_kwargs: dict[str, Any] = {
        "map_id": map_id,
        "character": character,
        "opponent_models": opponent_models,
        "classic_opponent_slots": classic_opponent_slots,
        "opponent_count": 1,
    }
    if seed is not None:
        reset_kwargs["seed"] = seed
    obs = env.reset_with(**reset_kwargs)
    done = False
    last_info: dict[str, Any] = {}
    while not done:
        if live_is_player or opponent_payload is None:
            q_vals = model(torch.tensor(obs, dtype=torch.float32).unsqueeze(0))
            action = int(torch.argmax(q_vals, dim=1).item())
        else:
            action = env.decide_headless_action(opponent_payload)
        obs, _, done, last_info = env.step(action)

    if last_info.get("eliminated"):
        return 0.0

    ranking = env.get_last_ranking()
    if last_info.get("battleWin") and ranking and ranking[0].get("charId") == character:
        return 1.0

    player_entry = next((r for r in ranking if r.get("charId") == character), None)
    opp_entry = next((r for r in ranking if r.get("charId") != character), None)
    if not player_entry or not opp_entry:
        return 0.5

    player_idx = ranking.index(player_entry)
    opp_idx = ranking.index(opp_entry)
    player_approvals = float(last_info.get("approvals", 0))
    opp_approvals = env.get_opponent_approvals(character)
    if player_approvals == opp_approvals:
        return 0.5
    return 1.0 if player_idx < opp_idx else 0.0


@torch.no_grad()
def score_battle_duel(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    seed: int | None = None,
) -> float:
    """Run a 1v1 duel; return 1.0 win, 0.5 draw, 0.0 loss from the live model perspective."""
    return _score_battle_duel_episode(
        env,
        model,
        map_id=map_id,
        character=character,
        opponent_payload=opponent_payload,
        live_payload=None,
        live_is_player=True,
        seed=seed,
    )


@torch.no_grad()
def _score_race_duel_episode(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    live_payload: dict[str, Any] | None,
    live_is_player: bool,
    seed: int | None = None,
) -> float:
    """Run one race duel; return 1.0 win, 0.5 draw, 0.0 loss from player-kart perspective."""
    if live_is_player:
        opponent_models = [opponent_payload] if opponent_payload else []
        classic_opponent_slots = 0 if opponent_payload else 1
    else:
        opponent_models = [live_payload] if live_payload else []
        classic_opponent_slots = 0 if live_payload else 1
    reset_kwargs: dict[str, Any] = {
        "map_id": map_id,
        "character": character,
        "opponent_models": opponent_models,
        "classic_opponent_slots": classic_opponent_slots,
        "opponent_count": 1,
        "race_position_reward": False,
    }
    if seed is not None:
        reset_kwargs["seed"] = seed
    obs = env.reset_with(**reset_kwargs)
    done = False
    last_info: dict[str, Any] = {}
    while not done:
        if live_is_player or opponent_payload is None:
            q_vals = model(torch.tensor(obs, dtype=torch.float32).unsqueeze(0))
            action = int(torch.argmax(q_vals, dim=1).item())
        else:
            action = env.decide_headless_action(opponent_payload)
        obs, _, done, last_info = env.step(action)

    ranking = env.get_last_ranking()
    player_entry = next((r for r in ranking if r.get("charId") == character), None)
    opp_entry = next((r for r in ranking if r.get("charId") != character), None)
    if not player_entry or not opp_entry:
        return 0.5

    player_finished = bool(player_entry.get("finished"))
    opp_finished = bool(opp_entry.get("finished"))
    if player_finished and not opp_finished:
        return 1.0
    if opp_finished and not player_finished:
        return 0.0
    if player_finished and opp_finished:
        player_idx = ranking.index(player_entry)
        opp_idx = ranking.index(opp_entry)
        if player_idx < opp_idx:
            return 1.0
        if player_idx > opp_idx:
            return 0.0
        return 0.5

    player_prog = float(player_entry.get("progress", last_info.get("progress", 0)))
    opp_prog = float(opp_entry.get("progress", 0))
    diff = player_prog - opp_prog
    if abs(diff) <= RACE_DUEL_PROGRESS_EPS:
        return 0.5
    return 1.0 if diff > 0 else 0.0


@torch.no_grad()
def score_race_duel(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    seed: int | None = None,
) -> float:
    """Run a 1v1 race duel; return 1.0 win, 0.5 draw, 0.0 loss from the live model perspective."""
    return _score_race_duel_episode(
        env,
        model,
        map_id=map_id,
        character=character,
        opponent_payload=opponent_payload,
        live_payload=None,
        live_is_player=True,
        seed=seed,
    )


@torch.no_grad()
def score_duel_pair(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    is_battle: bool,
    base_seed: int,
    step: int,
    duel_index: int,
) -> list[float]:
    """Run one live-as-player and one opponent-as-player duel; scores are from live model perspective."""
    score_episode = _score_battle_duel_episode if is_battle else _score_race_duel_episode
    live_seed = common.episode_seed(base_seed, duel_index * 2, step=step)
    live_score = score_episode(
        env,
        model,
        map_id=map_id,
        character=character,
        opponent_payload=opponent_payload,
        live_payload=None,
        live_is_player=True,
        seed=live_seed,
    )
    if opponent_payload is None:
        return [live_score]
    live_payload = live_model_duel_payload(model, env)
    opp_seed = common.episode_seed(base_seed, duel_index * 2 + 1, step=step)
    opp_player_score = score_episode(
        env,
        model,
        map_id=map_id,
        character=character,
        opponent_payload=opponent_payload,
        live_payload=live_payload,
        live_is_player=False,
        seed=opp_seed,
    )
    return [live_score, flip_duel_score(opp_player_score)]


@torch.no_grad()
def collect_balanced_duel_scores(
    env: Any,
    model: DQN,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
    is_battle: bool,
    num_duels: int,
    base_seed: int,
    step: int = 0,
) -> list[float]:
    """Run num_duels episodes with alternating player roles when a model opponent is available."""
    scores: list[float] = []
    pair_index = 0
    while len(scores) < num_duels:
        remaining = num_duels - len(scores)
        if opponent_payload is not None and remaining >= 2:
            scores.extend(
                score_duel_pair(
                    env,
                    model,
                    map_id=map_id,
                    character=character,
                    opponent_payload=opponent_payload,
                    is_battle=is_battle,
                    base_seed=base_seed,
                    step=step,
                    duel_index=pair_index,
                )
            )
            pair_index += 1
        else:
            seed = common.episode_seed(base_seed, len(scores), step=step)
            if is_battle:
                scores.append(
                    score_battle_duel(
                        env,
                        model,
                        map_id=map_id,
                        character=character,
                        opponent_payload=opponent_payload,
                        seed=seed,
                    )
                )
            else:
                scores.append(
                    score_race_duel(
                        env,
                        model,
                        map_id=map_id,
                        character=character,
                        opponent_payload=opponent_payload,
                        seed=seed,
                    )
                )
    return scores[:num_duels]


def run_elo_rating_round(
    eval_env: Any,
    model: DQN,
    args: argparse.Namespace,
    *,
    step: int,
    checkpoint_name: str,
    anchors: list[dict[str, Any]],
    checkpoint_pool: list[dict[str, Any]],
    elo_store: dict[str, Any],
    console: Console,
) -> dict[str, Any]:
    ratings = elo_store.setdefault("ratings", {})
    history = elo_store.setdefault("history", [])
    ratings.setdefault("classic", 1000.0)

    prev_ckpts = [c for c in checkpoint_pool if c["name"] != checkpoint_name]
    prev_rating = ratings.get(prev_ckpts[-1]["name"], 1000.0) if prev_ckpts else 1000.0
    ratings[checkpoint_name] = prev_rating
    rating_at_start = prev_rating

    is_battle = args.mode == "battle"
    duel_map = args.map if is_battle else args.elo_map

    opponents: list[tuple[str, dict[str, Any] | None]] = [("classic", None)]
    for anchor in anchors:
        opponents.append((anchor["name"], anchor["payload"]))
        ratings.setdefault(anchor["name"], 1000.0)
    for ckpt in prev_ckpts[-args.rating_recent_checkpoints :]:
        opponents.append((ckpt["name"], ckpt["payload"]))
        ratings.setdefault(ckpt["name"], 1000.0)

    records: dict[str, str] = {}
    for opp_name, opp_payload in opponents:
        wins = losses = draws = 0
        duel_scores = collect_balanced_duel_scores(
            eval_env,
            model,
            map_id=duel_map,
            character=args.character,
            opponent_payload=opp_payload,
            is_battle=is_battle,
            num_duels=args.rating_episodes,
            base_seed=args.seed,
            step=step,
        )
        for score in duel_scores:
            if score >= 1.0:
                wins += 1
            elif score <= 0.0:
                losses += 1
            else:
                draws += 1

            ckpt_rating = ratings[checkpoint_name]
            opp_rating = ratings[opp_name]
            if opp_name == "classic":
                new_ckpt, _ = common.elo_update(ckpt_rating, opp_rating, score, args.elo_k)
                ratings[checkpoint_name] = new_ckpt
            else:
                new_ckpt, new_opp = common.elo_update(ckpt_rating, opp_rating, score, args.elo_k)
                ratings[checkpoint_name] = new_ckpt
                ratings[opp_name] = new_opp

        records[opp_name] = f"{wins}-{losses}-{draws}"

    final_rating = ratings[checkpoint_name]
    delta = final_rating - rating_at_start
    history.append(
        {
            "step": step,
            "name": checkpoint_name,
            "rating": final_rating,
            "records": records,
            # Full ratings snapshot so anchor trajectories can be plotted later.
            "ratings_snapshot": {name: round(value, 2) for name, value in ratings.items()},
        }
    )

    table = Table(title=f"Elo Rating @ step {step} ({checkpoint_name})")
    table.add_column("Opponent")
    table.add_column("Rating", justify="right")
    table.add_column("W-L-D")
    for opp_name, _ in opponents:
        table.add_row(opp_name, f"{ratings[opp_name]:.1f}", records.get(opp_name, "-"))
    console.print(table)
    console.print(
        f"Checkpoint {checkpoint_name} Elo: {final_rating:.1f} "
        f"(Δ vs previous: {delta:+.1f})"
    )
    ckpt_history = [(h["step"], h["rating"]) for h in history if str(h.get("name", "")).startswith("ckpt-")]
    if ckpt_history:
        progression = ", ".join(f"({s},{r:.0f})" for s, r in ckpt_history)
        console.print(f"Elo progression: {progression}")
    return elo_store


def print_elo_ascii_chart(console: Console, history: list[dict[str, Any]], *, width: int = 64, height: int = 12) -> None:
    """Render the checkpoint Elo progression as a simple terminal chart."""
    points = sorted(
        (int(h["step"]), float(h["rating"]))
        for h in history
        if str(h.get("name", "")).startswith("ckpt-")
    )
    if len(points) < 2:
        return
    ratings = [r for _, r in points]
    lo, hi = min(ratings + [1000.0]), max(ratings + [1000.0])
    if hi - lo < 1e-9:
        hi = lo + 1.0
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad, hi + pad

    grid = [[" "] * width for _ in range(height)]
    def col(i: int) -> int:
        return round(i * (width - 1) / max(1, len(points) - 1))
    def row(r: float) -> int:
        return (height - 1) - round((r - lo) / (hi - lo) * (height - 1))

    baseline_row = row(1000.0)
    for x in range(width):
        grid[baseline_row][x] = "·"
    prev = None
    for i, (_, r) in enumerate(points):
        x, y = col(i), row(r)
        if prev is not None:
            px, py = prev
            step_dir = 1 if y > py else -1
            for yy in range(py + step_dir, y, step_dir):
                grid[yy][px] = "|"
        grid[y][x] = "●"
        prev = (x, y)

    console.print(f"[bold]Elo progression[/bold] (● checkpoints, ···· classic baseline 1000)")
    for y, line in enumerate(grid):
        label = f"{hi - (hi - lo) * y / (height - 1):7.0f} " if y in (0, baseline_row, height - 1) else "        "
        console.print(label + "".join(line), highlight=False)
    step_lo, step_hi = points[0][0], points[-1][0]
    console.print(f"        step {step_lo:,} … {step_hi:,}   final Elo {ratings[-1]:.1f}")


def resolve_classic_eval_every(args: argparse.Namespace) -> int:
    if args.classic_eval_every > 0:
        return args.classic_eval_every
    return args.elo_every


def live_checkpoint_label(step: int, checkpoint_every: int) -> str:
    rounded = (step // max(1, checkpoint_every)) * max(1, checkpoint_every)
    return f"live@{rounded}"


def payload_to_ckpt_label(payload: dict[str, Any]) -> str:
    meta = payload.get("meta") or {}
    ckpt_step = meta.get("step")
    if ckpt_step is not None:
        return f"ckpt-{int(ckpt_step)}"
    model_id = str(meta.get("id", ""))
    if "-step-" in model_id:
        return f"ckpt-{model_id.rsplit('-step-', 1)[-1]}"
    return "ckpt-unknown"


def payload_meta_id(payload: dict[str, Any]) -> str:
    return str((payload.get("meta") or {}).get("id", ""))


def payload_in_checkpoint_pool(
    payload: dict[str, Any],
    checkpoint_pool: list[dict[str, Any]],
) -> str | None:
    meta_id = payload_meta_id(payload)
    meta_step = (payload.get("meta") or {}).get("step")
    for entry in checkpoint_pool:
        pool_payload = entry.get("payload") or {}
        pool_meta = pool_payload.get("meta") or {}
        if meta_id and meta_id == str(pool_meta.get("id", "")):
            return str(entry["name"])
        if meta_step is not None and pool_meta.get("step") == meta_step:
            return str(entry["name"])
    return None


def payload_to_slot_label(
    payload: dict[str, Any],
    *,
    checkpoint_pool: list[dict[str, Any]],
    anchors: list[dict[str, Any]],
) -> str:
    pool_name = payload_in_checkpoint_pool(payload, checkpoint_pool)
    if pool_name:
        return pool_name
    meta_id = payload_meta_id(payload)
    for anchor in anchors:
        anchor_payload = anchor.get("payload") or {}
        if meta_id and meta_id == payload_meta_id(anchor_payload):
            return f"anchor:{anchor['name']}"
    if meta_id:
        return f"anchor:{meta_id}"
    return payload_to_ckpt_label(payload)


def duel_map_for_eval(args: argparse.Namespace) -> str:
    return args.arena_map if args.mode == "battle" else args.elo_map


@torch.no_grad()
def score_checkpoint_duel(
    env: Any,
    model: DQN,
    args: argparse.Namespace,
    *,
    map_id: str,
    character: str,
    opponent_payload: dict[str, Any] | None,
) -> float:
    if args.mode == "battle":
        return score_battle_duel(
            env,
            model,
            map_id=map_id,
            character=character,
            opponent_payload=opponent_payload,
        )
    return score_race_duel(
        env,
        model,
        map_id=map_id,
        character=character,
        opponent_payload=opponent_payload,
    )


def opponent_slot_char_ids(player_char: str, n_opponents: int) -> list[str]:
    try:
        player_idx = CHARACTER_IDS.index(player_char)
    except ValueError:
        player_idx = 0
    ai_chars = [char_id for idx, char_id in enumerate(CHARACTER_IDS) if idx != player_idx]
    return [ai_chars[idx % len(ai_chars)] for idx in range(n_opponents)]


def build_episode_opponent_setup(
    *,
    player_char: str,
    opponent_models: list[dict[str, Any]],
    classic_slots: int,
    opponent_count: int,
    step: int,
    checkpoint_every: int,
    checkpoint_pool: list[dict[str, Any]],
    anchors: list[dict[str, Any]],
) -> dict[str, Any]:
    slot_char_ids = opponent_slot_char_ids(player_char, opponent_count)
    slot_labels: list[str] = []
    for idx in range(opponent_count):
        if idx < classic_slots:
            slot_labels.append("classic")
        elif opponent_models:
            model_idx = (idx - classic_slots) % len(opponent_models)
            slot_labels.append(
                payload_to_slot_label(
                    opponent_models[model_idx],
                    checkpoint_pool=checkpoint_pool,
                    anchors=anchors,
                )
            )
        else:
            slot_labels.append("classic")
    return {
        "player_char": player_char,
        "live_label": live_checkpoint_label(step, checkpoint_every),
        "slot_char_ids": slot_char_ids,
        "slot_labels": slot_labels,
        "classic_slots": classic_slots,
        "opponent_count": opponent_count,
    }


def ranking_to_labels(
    ranking: list[dict[str, Any]],
    setup: dict[str, Any],
    *,
    step: int,
    checkpoint_every: int,
) -> list[str]:
    player_char = setup["player_char"]
    slot_char_ids = setup["slot_char_ids"]
    slot_labels = setup["slot_labels"]
    live_label = live_checkpoint_label(step, checkpoint_every)
    used_slots: set[int] = set()
    labels: list[str] = []
    for kart in ranking:
        char_id = kart.get("charId")
        slot = kart.get("slot")
        if char_id == player_char:
            labels.append(live_label)
            continue
        if isinstance(slot, int) and 0 <= slot < len(slot_labels):
            labels.append(slot_labels[slot])
            continue
        candidates = [
            idx for idx, slot_char in enumerate(slot_char_ids) if slot_char == char_id and idx not in used_slots
        ]
        if candidates:
            slot_idx = candidates[0]
            used_slots.add(slot_idx)
            labels.append(slot_labels[slot_idx])
        else:
            labels.append("unknown")
    return labels


def append_matchup_record(
    matchups_path: Path,
    *,
    step: int,
    map_id: str,
    ranking: list[str],
) -> None:
    matchups_path.parent.mkdir(parents=True, exist_ok=True)
    line = {"step": step, "map": map_id, "ranking": ranking}
    with matchups_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line) + "\n")


def compute_matchup_stats(matchups_path: Path) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    if not matchups_path.exists():
        return {}, {}
    records: list[dict[str, Any]] = []
    for raw_line in matchups_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    model_controlled = lambda label: (
        label.startswith("live@") or label.startswith("ckpt-") or label.startswith("anchor:")
    )
    stats: dict[str, dict[str, float]] = {}
    elo: dict[str, float] = {}

    for record in records:
        ranking = record.get("ranking") or []
        if not ranking:
            continue
        present = {label for label in ranking if label != "unknown"}
        for label in present:
            entry = stats.setdefault(label, {"races": 0, "model_wins": 0})
            entry["races"] += 1
            model_ranking = [label for label in ranking if model_controlled(label)]
            if model_ranking and model_ranking[0] == label:
                entry["model_wins"] += 1

        for winner_idx, winner in enumerate(ranking):
            if winner == "unknown":
                continue
            elo.setdefault(winner, 1000.0)
            for loser in ranking[winner_idx + 1 :]:
                if loser == "unknown":
                    continue
                elo.setdefault(loser, 1000.0)
                new_winner, new_loser = common.elo_update(
                    elo[winner], elo[loser], 1.0, MATCHUP_ELO_K
                )
                elo[winner] = new_winner
                elo[loser] = new_loser

    for entry in stats.values():
        races = max(1.0, entry["races"])
        entry["win_rate"] = entry["model_wins"] / races
    return stats, elo


def print_matchup_ranking_table(console: Console, stats: dict[str, dict[str, float]], elo: dict[str, float]) -> None:
    if not stats:
        return
    table = Table(title="Matchup ranking (multiplayer Elo + win rate)")
    table.add_column("Label", style="cyan")
    table.add_column("Elo", justify="right", style="green")
    table.add_column("Races", justify="right")
    table.add_column("Win rate", justify="right")
    rows = sorted(
        stats.keys(),
        key=lambda label: (-elo.get(label, 1000.0), -stats[label].get("win_rate", 0.0), label),
    )
    for label in rows:
        entry = stats[label]
        table.add_row(
            label,
            f"{elo.get(label, 1000.0):.1f}",
            str(int(entry.get("races", 0))),
            f"{entry.get('win_rate', 0.0):.2f}",
        )
    console.print(table)


@torch.no_grad()
def run_classic_baseline_eval(
    eval_env: Any,
    model: DQN,
    args: argparse.Namespace,
    *,
    step: int,
    console: Console,
) -> dict[str, float]:
    is_battle = args.mode == "battle"
    eval_map = duel_map_for_eval(args)
    opponent_count = (args.battle_opponents or 3) if is_battle else args.race_opponents
    wins = 0
    places: list[float] = []
    for ep_idx in range(args.classic_eval_episodes):
        reset_kwargs: dict[str, Any] = {
            "map_id": eval_map,
            "character": args.character,
            "opponent_models": [],
            "classic_opponent_slots": opponent_count,
            "opponent_count": opponent_count,
            "seed": common.episode_seed(args.seed, ep_idx, step=step),
        }
        if not is_battle:
            reset_kwargs["race_position_reward"] = False
        obs = eval_env.reset_with(**reset_kwargs)
        done = False
        while not done:
            q_vals = model(torch.tensor(obs, dtype=torch.float32).unsqueeze(0))
            action = int(torch.argmax(q_vals, dim=1).item())
            obs, _, done, _ = eval_env.step(action)
        ranking = eval_env.get_episode_ranking()
        player_rank = next(
            (idx + 1 for idx, kart in enumerate(ranking) if kart.get("charId") == args.character),
            float(len(ranking) + 1),
        )
        places.append(float(player_rank))
        if player_rank == 1:
            wins += 1
    episodes = max(1, args.classic_eval_episodes)
    metrics = {
        "step": step,
        "win_rate": wins / episodes,
        "avg_place": float(np.mean(places)) if places else 0.0,
    }
    mode_tag = f" ({args.mode})" if is_battle else ""
    console.print(
        f"Classic baseline{mode_tag} @ step {step}: "
        f"win_rate={metrics['win_rate']:.2f} avg_place={metrics['avg_place']:.1f}"
    )
    return metrics


def print_classic_baseline_ascii_chart(
    console: Console,
    progression: list[dict[str, float]],
    *,
    mode: str | None = None,
    width: int = 64,
    height: int = 12,
) -> None:
    if len(progression) < 2:
        return
    points = sorted((int(p["step"]), float(p["win_rate"])) for p in progression)
    win_rates = [rate for _, rate in points]
    lo, hi = min(win_rates + [0.0]), max(win_rates + [1.0])
    if hi - lo < 1e-9:
        hi = lo + 0.1
    pad = (hi - lo) * 0.08
    lo, hi = max(0.0, lo - pad), min(1.0, hi + pad)

    grid = [[" "] * width for _ in range(height)]

    def col(i: int) -> int:
        return round(i * (width - 1) / max(1, len(points) - 1))

    def row(rate: float) -> int:
        return (height - 1) - round((rate - lo) / (hi - lo) * (height - 1))

    prev = None
    for i, (_, rate) in enumerate(points):
        x, y = col(i), row(rate)
        if prev is not None:
            px, py = prev
            step_dir = 1 if y > py else -1
            for yy in range(py + step_dir, y, step_dir):
                grid[yy][px] = "|"
        grid[y][x] = "●"
        prev = (x, y)

    mode_note = f" ({mode})" if mode else ""
    console.print(
        f"[bold]Classic baseline progression{mode_note}[/bold] (● win rate vs classic-only opponents)"
    )
    for y, line in enumerate(grid):
        label = f"{hi - (hi - lo) * y / (height - 1):5.2f} " if y in (0, height - 1) else "      "
        console.print(label + "".join(line), highlight=False)
    step_lo, step_hi = points[0][0], points[-1][0]
    console.print(f"      step {step_lo:,} … {step_hi:,}   final win_rate {win_rates[-1]:.2f}")


@torch.no_grad()
def run_checkpoint_ladder(
    eval_env: Any,
    model: DQN,
    args: argparse.Namespace,
    *,
    step: int,
    checkpoint_pool: list[dict[str, Any]],
    console: Console,
) -> dict[str, Any] | None:
    if args.ladder_duels <= 0:
        return None
    newest_name = f"ckpt-{step}"
    prev_ckpts = [entry for entry in checkpoint_pool if entry["name"] != newest_name]
    if not prev_ckpts:
        return None
    previous = prev_ckpts[-1]
    wins = losses = draws = 0
    duel_map = duel_map_for_eval(args)
    duel_scores = collect_balanced_duel_scores(
        eval_env,
        model,
        map_id=duel_map,
        character=args.character,
        opponent_payload=previous["payload"],
        is_battle=args.mode == "battle",
        num_duels=args.ladder_duels,
        base_seed=args.seed,
        step=step,
    )
    for score in duel_scores:
        if score >= 1.0:
            wins += 1
        elif score <= 0.0:
            losses += 1
        else:
            draws += 1
    record = f"{wins}-{losses}-{draws}"
    beats = wins > losses
    console.print(f"Ladder: {newest_name} vs {previous['name']} -> {record}")
    return {
        "newest": newest_name,
        "previous": previous["name"],
        "record": record,
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "beats_predecessor": beats,
    }


def print_ladder_table(console: Console, ladder_history: list[dict[str, Any]]) -> None:
    if not ladder_history:
        return
    table = Table(title="Checkpoint ladder (newest vs previous)")
    table.add_column("Matchup", style="cyan")
    table.add_column("W-L-D", justify="right")
    table.add_column("Beats predecessor", justify="right", style="green")
    for entry in ladder_history:
        matchup = f"{entry['newest']} vs {entry['previous']}"
        beats = "yes" if entry.get("beats_predecessor") else "no"
        table.add_row(matchup, entry.get("record", "-"), beats)
    console.print(table)


def check_self_play_applied(
    env: Any, args: argparse.Namespace, console: Console, checked: bool, requested_models: int = -1
) -> bool:
    if checked or not args.self_play:
        return checked
    if requested_models == 0:
        # Nothing was requested this episode (e.g. pure self-play before the first
        # checkpoint exists) — keep waiting for an episode that does request models.
        return False
    applied = int(env.last_reset_info.get("opponentModelsApplied", 0) or 0)
    if applied == 0:
        console.print(
            Panel(
                "[bold red]Self-play opponent models were NOT applied by the browser.[/bold red]\n"
                "TrainedAIKart opponents may be missing — check makeHeadlessConfig pass-through.",
                title="Self-Play Warning",
                border_style="red",
            )
        )
    return True


def sample_character(args: argparse.Namespace) -> str:
    if not args.random_character:
        return args.character
    return random.choice(parse_csv(args.characters))


def sample_map(args: argparse.Namespace) -> str:
    if not args.random_map:
        return args.map
    return random.choice(parse_csv(args.maps))


@torch.no_grad()
def evaluate(
    env: Any,
    model: DQN,
    episodes: int,
    *,
    map_id: str,
    character: str,
    characters: list[str] | None = None,
    solo: bool,
    opponent_models: list[dict[str, Any]] | None = None,
    opponent_count: int | None = None,
    classic_opponent_slots: int | None = None,
    base_seed: int = 0,
    eval_step: int = 0,
    race_position_reward: bool | None = None,
) -> dict[str, Any]:
    old_solo = env.solo
    old_opponents = env.opponent_models
    env.solo = solo
    env.opponent_models = opponent_models or []
    if opponent_count is None:
        opponent_count = 0 if solo else len(env.opponent_models)
    if classic_opponent_slots is None:
        classic_opponent_slots = opponent_count if not solo else 0
    finishes = 0
    rewards = []
    laps = []
    race_times = []
    progresses = []
    coins = []
    item_uses = []
    ult_uses = []
    drift_boosts = []
    approvals_left = []
    steals = []
    battle_wins = 0
    winner_chars: dict[str, int] = {}
    player_wins = 0
    try:
        for ep_idx in range(episodes):
            eval_char = random.choice(characters) if characters else character
            reset_kwargs: dict[str, Any] = {
                "map_id": map_id,
                "character": eval_char,
                "opponent_models": env.opponent_models,
                "classic_opponent_slots": classic_opponent_slots,
                "opponent_count": opponent_count,
                "seed": common.episode_seed(base_seed, ep_idx, step=eval_step),
            }
            if race_position_reward is not None:
                reset_kwargs["race_position_reward"] = race_position_reward
            obs = env.reset_with(**reset_kwargs)
            done = False
            total_reward = 0.0
            last_info: dict[str, Any] = {}
            while not done:
                q = model(torch.tensor(obs, dtype=torch.float32).unsqueeze(0))
                action = int(torch.argmax(q, dim=1).item())
                obs, reward, done, last_info = env.step(action)
                total_reward += reward
            finishes += int(bool(last_info.get("finished")))
            ranking = env.get_last_ranking()
            if ranking:
                winner = ranking[0].get("charId") or ranking[0].get("name") or "unknown"
                winner_chars[winner] = winner_chars.get(winner, 0) + 1
                if winner == eval_char:
                    player_wins += 1
            rewards.append(total_reward)
            laps.append(float(last_info.get("lap", 0)))
            race_times.append(float(last_info.get("raceTime", 0)))
            progresses.append(float(last_info.get("progress", 0)))
            coins.append(float(last_info.get("coins", 0)))
            item_uses.append(float(last_info.get("itemUses", 0)))
            ult_uses.append(float(last_info.get("ultUses", 0)))
            drift_boosts.append(float(last_info.get("driftBoosts", 0)))
            approvals_left.append(float(last_info.get("approvals", 0)))
            steals.append(float(last_info.get("steals", 0)))
            battle_wins += int(bool(last_info.get("battleWin")))
    finally:
        env.solo = old_solo
        env.opponent_models = old_opponents

    return {
        "episodes": episodes,
        "finish_rate": finishes / max(1, episodes),
        "avg_reward": float(np.mean(rewards)) if rewards else 0.0,
        "avg_laps": float(np.mean(laps)) if laps else 0.0,
        "avg_race_time": float(np.mean(race_times)) if race_times else 0.0,
        "avg_progress": float(np.mean(progresses)) if progresses else 0.0,
        "avg_coins": float(np.mean(coins)) if coins else 0.0,
        "avg_item_uses": float(np.mean(item_uses)) if item_uses else 0.0,
        "avg_ult_uses": float(np.mean(ult_uses)) if ult_uses else 0.0,
        "avg_drift_boosts": float(np.mean(drift_boosts)) if drift_boosts else 0.0,
        "avg_approvals_left": float(np.mean(approvals_left)) if approvals_left else 0.0,
        "avg_steals": float(np.mean(steals)) if steals else 0.0,
        "avg_survival_time": float(np.mean(race_times)) if race_times else 0.0,
        "battle_win_rate": battle_wins / max(1, episodes),
        "winner_chars": winner_chars,
        "player_win_rate": player_wins / max(1, episodes),
    }


def evaluate_tracks(env: Any, model: DQN, args: argparse.Namespace, *, eval_step: int = 0) -> dict[str, Any]:
    per_track: dict[str, Any] = {}
    eval_maps = parse_csv(args.eval_maps)
    is_battle = getattr(args, "mode", "race") == "battle"
    opponent_count = (args.battle_opponents or 3) if is_battle else args.race_opponents
    for map_id in eval_maps:
        char = args.character
        eval_chars = parse_csv(args.characters) if args.random_character else None
        if is_battle:
            # Arena is always a free-for-all; there is no meaningful "solo" battle.
            per_track[map_id] = {
                "battle": evaluate(
                    env,
                    model,
                    args.episodes_eval,
                    map_id=map_id,
                    character=char,
                    characters=eval_chars,
                    solo=False,
                    opponent_models=[],
                    opponent_count=opponent_count,
                    classic_opponent_slots=opponent_count,
                    base_seed=args.seed,
                    eval_step=eval_step,
                ),
            }
        else:
            per_track[map_id] = {
                "solo": evaluate(
                    env,
                    model,
                    args.episodes_eval,
                    map_id=map_id,
                    character=char,
                    characters=eval_chars,
                    solo=True,
                    opponent_models=[],
                    opponent_count=0,
                    classic_opponent_slots=0,
                    base_seed=args.seed,
                    eval_step=eval_step,
                    race_position_reward=False,
                ),
                "classic": evaluate(
                    env,
                    model,
                    args.episodes_eval,
                    map_id=map_id,
                    character=char,
                    characters=eval_chars,
                    solo=False,
                    opponent_models=[],
                    opponent_count=opponent_count,
                    classic_opponent_slots=opponent_count,
                    base_seed=args.seed,
                    eval_step=eval_step,
                    race_position_reward=False,
                ),
            }
    primary = "battle" if is_battle else "classic"
    avg_reward = float(np.mean([m[primary]["avg_reward"] for m in per_track.values()])) if per_track else 0.0
    avg_finish = float(np.mean([m[primary]["finish_rate"] for m in per_track.values()])) if per_track else 0.0
    return {"avg_reward": avg_reward, "avg_finish_rate": avg_finish, "tracks": per_track}


def run_headless_waypoint_reference(
    page: Page,
    index_path: Path,
    *,
    map_id: str,
    character: str,
    frames: int,
    episodes: int,
    solo: bool,
    no_items: bool,
    no_hazards: bool,
) -> dict[str, float]:
    flags = [
        "headless=1",
        "agent=waypoint",
        f"map={map_id}",
        f"char={character}",
        f"frames={frames}",
        f"episodes={episodes}",
        f"solo={1 if solo else 0}",
        f"noItems={1 if no_items else 0}",
        f"noHazards={1 if no_hazards else 0}",
    ]
    page.goto(index_path.resolve().as_uri() + "?" + "&".join(flags), wait_until="load")
    result = page.evaluate("window.__HEADLESS_RESULT__")
    aggregate = result.get("aggregate", {})
    return {
        "episodes": episodes,
        "finish_rate": float(aggregate.get("finishCount", 0)) / max(1, episodes),
        "avg_reward": float(aggregate.get("avgReward", 0)),
        "avg_laps": float(aggregate.get("totalPlayerLaps", 0)) / max(1, episodes),
        "avg_progress": float(aggregate.get("avgPlayerProgress", 0)),
    }


def waypoint_references(browser: Any, index_path: Path, args: argparse.Namespace) -> dict[str, dict[str, float]]:
    page = browser.new_page()
    refs = {}
    for map_id in parse_csv(args.eval_maps):
        refs[map_id] = run_headless_waypoint_reference(
            page,
            index_path,
            map_id=map_id,
            character=args.character,
            frames=args.frames,
            episodes=args.reference_episodes,
            solo=args.solo,
            no_items=args.no_items,
            no_hazards=args.no_hazards,
        )
    page.close()
    return refs


def run_benchmark(args: argparse.Namespace, index_path: Path) -> None:
    is_battle = args.mode == "battle"
    if is_battle:
        args.map = args.arena_map
        args.solo = False
        args.no_items = False
        args.no_hazards = True

    page = None
    browser_ctx = None
    if args.backend == "browser":
        from playwright.sync_api import sync_playwright

        browser_ctx = sync_playwright()
    with browser_ctx if browser_ctx is not None else contextlib.nullcontext() as p:
        if args.backend == "browser":
            browser = common.launch_chromium(p, args.auto_install_browser)
            page = browser.new_page()
        env = common.make_env(
            args.backend,
            index_path=index_path,
            page=page,
            map_id=args.map,
            character=args.character,
            frames=args.frames,
            solo=args.solo,
            no_items=args.no_items,
            no_hazards=args.no_hazards,
            frame_stack=args.frame_stack,
            frame_skip=args.frame_skip,
            mode=args.mode,
        )
        try:
            env.load()
            obs = env.reset_with()
            obs_dim = int(obs.shape[0])
            action_dim = len(env.actions)
            q = DQN(obs_dim, action_dim, args.hidden)
            policy = build_compact_dqn_policy(
                q,
                env.obs_keys,
                env.actions,
                meta={"frameStack": args.frame_stack, "frameSkip": args.frame_skip, "mode": args.mode},
            )
            env.set_rollout_policy(policy)

            steps = 0
            batch_size = max(1, args.rollout_batch_size)
            started = time.perf_counter()
            while steps < args.benchmark:
                batch_k = min(batch_size, args.benchmark - steps)
                epsilons = [1.0] * batch_k
                rollout_result = env.rollout(
                    None,
                    epsilons,
                    rollout_seed(args.seed, steps + 1),
                    max_steps=batch_k,
                    reuse_cached_policy=True,
                )
                if rollout_result.stopped_reason == "alreadyDone":
                    env.reset_with()
                    continue
                steps += len(rollout_result.entries)
            elapsed = time.perf_counter() - started
            report = {
                "backend": args.backend,
                "env_steps_per_sec": round(steps / max(elapsed, 1e-9), 2),
                "wall_seconds": round(elapsed, 4),
                "steps": steps,
            }
            print(json.dumps(report))
        finally:
            env.close()
            if page is not None:
                page.close()
                browser.close()


def train(args: argparse.Namespace) -> None:
    console = Console()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    is_battle = args.mode == "battle"
    if is_battle:
        # Arena is a single-map free-for-all: opponents + items ON, hazards OFF, no lap navigation.
        args.map = args.arena_map
        args.maps = args.arena_map
        args.eval_maps = args.arena_map
        args.random_map = False
        args.solo = False
        args.no_items = False
        args.no_hazards = True
        # Avoid clobbering the race model when only defaults are used.
        if args.model_id == "dqn-latest":
            args.model_id = "dqn-arena"
        if args.model_name == "DQN Latest":
            args.model_name = "DQN Arena"
        if args.out == "models/dqn-latest.json":
            args.out = "models/dqn-arena.json"
    elif args.anchor_models == BATTLE_DEFAULT_ANCHORS:
        args.anchor_models = RACE_DEFAULT_ANCHORS

    if args.rollout_batch_size > 1 and args.l2_norm:
        raise ValueError(
            "JS rollout inference does not support --l2-norm. "
            "Use --rollout-batch-size 1 for legacy per-step Python action selection."
        )
    if args.rollout_batch_size < 1:
        raise ValueError("--rollout-batch-size must be >= 1")
    if args.rollout_policy_sync_steps < 1:
        raise ValueError("--rollout-policy-sync-steps must be >= 1")

    index_path = Path(args.index).resolve()
    if not index_path.exists():
        raise FileNotFoundError(index_path)

    if args.benchmark:
        run_benchmark(args, index_path)
        return

    browser_ctx = None
    if args.backend == "browser":
        from playwright.sync_api import sync_playwright

        browser_ctx = sync_playwright()
    with browser_ctx if browser_ctx is not None else contextlib.nullcontext() as p:
        browser = common.launch_chromium(p, args.auto_install_browser) if args.backend == "browser" else None
        page = browser.new_page() if browser is not None else None
        env = common.make_env(
            args.backend,
            index_path=index_path,
            page=page,
            map_id=args.map,
            character=args.character,
            frames=args.frames,
            solo=args.solo,
            no_items=args.no_items,
            no_hazards=args.no_hazards,
            frame_stack=args.frame_stack,
            frame_skip=args.frame_skip,
            mode=args.mode,
            race_position_reward=args.race_position_reward,
        )
        env.load()
        league = common.load_league_models(Path(args.league_manifest), args.league_limit, mode=args.mode) if args.self_play else []
        anchors = (
            load_anchor_models(Path(args.league_manifest), parse_csv(args.anchor_models), console=console)
            if args.self_play
            else []
        )
        checkpoint_pool: list[dict[str, Any]] = []
        elo_store = common.load_elo_store(Path(args.checkpoint_dir) / f"elo-{args.model_id}.json")
        self_play_checked = False
        curriculum_rng = random.Random(args.seed ^ common.CURRICULUM_RNG_SALT)
        opponent_sample_rng = random.Random(args.seed ^ 0x0B10A11)
        recent_opponent_counts: deque[int] = deque(maxlen=50)
        checkpoints_exported: set[int] = set()
        eval_event_count = 0
        latest_eval_report: dict[str, Any] | None = None
        latest_eval_metrics: dict[str, Any] | None = None
        latest_attribution: dict[str, float] | None = None
        classic_baseline_progression: list[dict[str, float]] = []
        ladder_history: list[dict[str, Any]] = []
        current_episode_setup: dict[str, Any] | None = None
        self_play_instrumented = args.self_play and not args.race_league
        classic_eval_every = resolve_classic_eval_every(args) if self_play_instrumented else 0
        matchups_path = Path("runs") / f"{args.model_id}-matchups.jsonl"
        if self_play_instrumented:
            matchups_path.parent.mkdir(parents=True, exist_ok=True)
            if matchups_path.exists():
                matchups_path.unlink()

        def default_opponent_count() -> int:
            if is_battle:
                return args.battle_opponents or 3
            return args.race_opponents

        def capture_episode_setup(step: int, reset_kwargs: dict[str, Any]) -> None:
            nonlocal current_episode_setup
            if not self_play_instrumented:
                current_episode_setup = None
                return
            opponent_models = reset_kwargs.get("opponent_models") or []
            classic_slots = int(reset_kwargs.get("classic_opponent_slots") or 0)
            opponent_count = int(reset_kwargs.get("opponent_count") or default_opponent_count())
            if opponent_count <= 0:
                current_episode_setup = None
                return
            current_episode_setup = build_episode_opponent_setup(
                player_char=str(reset_kwargs.get("character") or env.character),
                opponent_models=opponent_models,
                classic_slots=classic_slots,
                opponent_count=opponent_count,
                step=step,
                checkpoint_every=args.checkpoint_every,
                checkpoint_pool=checkpoint_pool,
                anchors=anchors,
            )

        def training_reset_kwargs(step: int, episode_index: int) -> dict[str, Any]:
            opp_count = battle_training_opponent_count(args, step, curriculum_rng)
            if opp_count is not None:
                total_slots = opp_count
            elif args.self_play and not is_battle and not args.race_league:
                opp_count = args.race_opponents
                total_slots = args.race_opponents
            else:
                total_slots = 4
            opponents, classic_slots = resolve_training_opponents(
                args,
                is_battle=is_battle,
                league=league,
                anchors=anchors,
                checkpoint_pool=checkpoint_pool,
                total_slots=total_slots,
                rng=opponent_sample_rng,
            )
            kwargs: dict[str, Any] = {
                "map_id": common.sample_map(args),
                "character": common.sample_character(args),
                "opponent_models": opponents,
                "seed": common.episode_seed(args.seed, episode_index, step=step),
            }
            if classic_slots is not None:
                kwargs["classic_opponent_slots"] = classic_slots
            elif opp_count is not None:
                kwargs["classic_opponent_slots"] = 0
            elif args.self_play and not is_battle and not args.race_league:
                kwargs["classic_opponent_slots"] = 0
            else:
                kwargs["classic_opponent_slots"] = 0
            if opp_count is not None:
                kwargs["opponent_count"] = opp_count
                recent_opponent_counts.append(opp_count)
            if args.race_position_reward:
                kwargs["race_position_reward"] = True
            return kwargs

        reset_kwargs = training_reset_kwargs(0, 0)
        obs = env.reset_with(**reset_kwargs)
        capture_episode_setup(0, reset_kwargs)
        self_play_checked = check_self_play_applied(
            env, args, console, self_play_checked, len(reset_kwargs["opponent_models"])
        )
        eval_page = browser.new_page() if browser is not None else None
        eval_env = common.make_env(
            args.backend,
            index_path=index_path,
            page=eval_page,
            map_id=args.map,
            character=args.character,
            frames=args.frames,
            solo=args.solo,
            no_items=args.no_items,
            no_hazards=args.no_hazards,
            frame_stack=args.frame_stack,
            frame_skip=args.frame_skip,
            mode=args.mode,
        )
        eval_env.load()
        obs_dim = int(obs.shape[0])
        action_dim = len(env.actions)

        q = DQN(
            obs_dim,
            action_dim,
            args.hidden,
            activation=args.activation,
            layer_norm=args.layer_norm,
            l2_norm=args.l2_norm,
            orthogonal_init=args.orthogonal_init,
            weight_norm=args.weight_norm,
            mean_expansion_k=args.mean_expansion_k,
            advantage_centering=not args.rdq,
        )
        target_q = DQN(
            obs_dim,
            action_dim,
            args.hidden,
            activation=args.activation,
            layer_norm=args.layer_norm,
            l2_norm=args.l2_norm,
            orthogonal_init=args.orthogonal_init,
            weight_norm=args.weight_norm,
            mean_expansion_k=args.mean_expansion_k,
            advantage_centering=not args.rdq,
        )
        target_q.load_state_dict(q.state_dict())
        optimizer = torch.optim.Adam(q.parameters(), lr=args.lr)
        if env.frame_stack > 1 and not hasattr(env, "_stack_mask"):
            env._build_stack_mask()
        buffer = common.FrameReplayBuffer(
            capacity=args.buffer_size,
            base_dim=len(env._base_keys),
            frame_stack=args.frame_stack,
            stack_mask=getattr(env, "_stack_mask", None),
            dtype=args.replay_dtype,
            alpha=args.per_alpha if args.prioritized_replay else None,
            n_step=args.n_step,
            gamma=args.gamma,
        )
        buffer.start_episode(env.last_base_obs)

        episode_reward = 0.0
        episode_count = 0
        best_eval_reward = -math.inf
        last_loss = None
        started_at = time.perf_counter()
        recent_rewards: deque[float] = deque(maxlen=20)
        recent_laps: deque[float] = deque(maxlen=20)
        recent_finishes: deque[float] = deque(maxlen=20)
        recent_maps: deque[str] = deque(maxlen=20)
        recent_chars: deque[str] = deque(maxlen=20)
        action_counts = np.zeros(action_dim, dtype=np.int64)
        recent_action_counts = np.zeros(action_dim, dtype=np.int64)
        recent_q_max: deque[float] = deque(maxlen=1000)
        recent_q_mean: deque[float] = deque(maxlen=1000)
        primary_key = "battle" if is_battle else "classic"
        # The waypoint reference baseline is a race concept (laps/progress); skip it for arena.
        reference_metrics = (
            common.waypoint_references(browser, index_path, args)
            if args.reference_episodes > 0 and not is_battle and args.backend == "browser"
            else {}
        )

        start_payload = {
            "event": "start",
            "mode": args.mode,
            "self_play": args.self_play,
            "league_models": len(league),
            "obs_dim": obs_dim,
            "action_dim": action_dim,
            "steps": args.steps,
            "map": args.map,
            "character": args.character,
            "solo": args.solo,
            "no_items": args.no_items,
            "no_hazards": args.no_hazards,
            "frame_stack": args.frame_stack,
            "frame_skip": args.frame_skip,
            "mean_expansion_k": args.mean_expansion_k,
            "rdq": args.rdq,
            "rdq_beta": args.rdq_beta if args.rdq else 0.0,
            "checkpoint_every": args.checkpoint_every,
            "eval_every": args.eval_every,
            "elo_every": args.elo_every,
            "smoothgrad_every": args.smoothgrad_every,
            "battle_opponent_curriculum": args.battle_opponent_curriculum,
            "battle_opponents_fixed": args.battle_opponents,
            "rollout_batch_size": args.rollout_batch_size,
            "rollout_policy_sync_steps": args.rollout_policy_sync_steps,
        }
        if args.json_logs:
            emit_json(start_payload)
            progress = None
            task_id = None
        else:
            panel_lines = [
                f"[bold]Map[/bold]: {args.map}",
                f"[bold]Base character[/bold]: {args.character}",
                "[bold]Training characters[/bold]: "
                f"{args.characters if args.random_character else args.character}",
                f"[bold]Observations[/bold]: {obs_dim}",
                f"[bold]Actions[/bold]: {action_dim}",
                f"[bold]Steps[/bold]: {args.steps}",
                f"[bold]Eval maps[/bold]: {args.eval_maps}",
                f"[bold]Training maps[/bold]: {args.maps if args.random_map else args.map}",
                f"[bold]Random map[/bold]: {args.random_map}",
                f"[bold]Random character[/bold]: {args.random_character}",
                f"[bold]Frame stack[/bold]: {args.frame_stack}",
                f"[bold]Frame skip[/bold]: {args.frame_skip}",
                f"[bold]Activation[/bold]: {args.activation}",
                f"[bold]LayerNorm[/bold]: {args.layer_norm}",
                f"[bold]L2 Norm[/bold]: {args.l2_norm}",
                f"[bold]Orthogonal init[/bold]: {args.orthogonal_init}",
                f"[bold]Weight norm[/bold]: {args.weight_norm}",
                f"[bold]Mean expansion k[/bold]: {args.mean_expansion_k}",
                f"[bold]RDQ[/bold]: {args.rdq} (β={args.rdq_beta if args.rdq else 0.0})",
                f"[bold]PER[/bold]: {args.prioritized_replay}"
                + (f" (α={args.per_alpha}, β={args.per_beta_start}→{args.per_beta_end})" if args.prioritized_replay else ""),
                f"[bold]N-step[/bold]: {args.n_step} (γ={args.gamma})",
                f"[bold]Rollout batch[/bold]: {args.rollout_batch_size}"
                + (
                    f" (policy sync every {args.rollout_policy_sync_steps} steps; "
                    f"≤{args.rollout_policy_sync_steps - 1} updates stale)"
                    if args.rollout_batch_size > 1
                    else " (legacy per-step Python)"
                ),
                f"[bold]Replay dtype[/bold]: {args.replay_dtype} "
                f"({buffer.memory_bytes / 1024 / 1024:.2f} MiB buffer)",
                f"[bold]Self-play[/bold]: {args.self_play} ({len(league)} league models)"
                + (f", {len(anchors)} anchors" if anchors else ""),
                f"[bold]Checkpoint every[/bold]: {args.checkpoint_every}",
                f"[bold]Eval every[/bold]: {args.eval_every}",
                f"[bold]Elo every[/bold]: {args.elo_every}",
                f"[bold]SmoothGrad every[/bold]: {args.smoothgrad_every} eval(s)"
                + (
                    ""
                    if args.smoothgrad_every == 0
                    else f" ({args.smoothgrad_samples} samples, noise={args.smoothgrad_noise})"
                ),
            ]
            if is_battle and args.self_play:
                if args.battle_opponents is not None:
                    panel_lines.append(f"[bold]Battle opponents[/bold]: fixed {args.battle_opponents}")
                else:
                    panel_lines.append(
                        "[bold]Battle curriculum[/bold]: "
                        f"{args.battle_opponent_curriculum_parsed.summary()}"
                    )
            elif args.self_play and not is_battle:
                if args.race_league:
                    panel_lines.append(f"[bold]Race self-play[/bold]: league ({args.league_opponents} slots)")
                else:
                    panel_lines.append(
                        f"[bold]Race self-play[/bold]: checkpoint pool ({args.race_opponents} slots, "
                        f"classic_prob={args.race_classic_prob})"
                    )
            console.print(
                Panel.fit(
                    "\n".join(panel_lines),
                    title="TurboKart DQN Training",
                    border_style="cyan",
                )
            )
            progress = Progress(
                TextColumn("[bold cyan]training"),
                BarColumn(),
                TextColumn("{task.percentage:>5.1f}%"),
                TextColumn("step {task.completed:.0f}/{task.total:.0f}"),
                TextColumn("eps {task.fields[eps]}"),
                TextColumn("loss {task.fields[loss]}"),
                TextColumn("ep {task.fields[episodes]}"),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
                console=console,
            )
            progress.start()
            task_id = progress.add_task(
                "train",
                total=args.steps,
                eps=f"{args.eps_start:.3f}",
                loss="-",
                episodes="0",
            )

        def process_transition(
            step: int,
            eps: float,
            action: int,
            stacked_obs: np.ndarray,
            base_obs: np.ndarray,
            reward: float,
            done: bool,
            info: dict[str, Any],
            *,
            q_max: float | None = None,
            q_mean: float | None = None,
        ) -> bool:
            """Apply one environment transition and training hooks. Returns True if episode ended."""
            nonlocal obs, episode_reward, episode_count, last_loss, league, self_play_checked

            action_counts[action] += 1
            recent_action_counts[action] += 1
            if q_max is not None:
                recent_q_max.append(q_max)
            if q_mean is not None:
                recent_q_mean.append(q_mean)

            record_replay_transition(buffer, base_obs, action, reward, done)
            obs = stacked_obs
            episode_reward += reward

            if done:
                episode_count += 1
                if (
                    self_play_instrumented
                    and current_episode_setup is not None
                    and current_episode_setup.get("opponent_count", 0) > 0
                ):
                    ranking = env.get_episode_ranking()
                    labels = ranking_to_labels(
                        ranking,
                        current_episode_setup,
                        step=step,
                        checkpoint_every=args.checkpoint_every,
                    )
                    append_matchup_record(
                        matchups_path,
                        step=step,
                        map_id=env.map_id,
                        ranking=labels,
                    )
                if episode_count % args.log_every_episodes == 0:
                    episode_payload = {
                        "event": "episode",
                        "episode": episode_count,
                        "step": step,
                        "epsilon": round(eps, 4),
                        "episode_reward": round(episode_reward, 3),
                        "lap": info.get("lap"),
                        "finished": info.get("finished"),
                        "progress": round(float(info.get("progress", 0)), 3),
                    }
                    if is_battle and args.self_play:
                        episode_payload["battle_opponents"] = env.last_reset_info.get("opponentCount")
                    elif args.self_play and not is_battle and not args.race_league:
                        episode_payload["opponent_models_applied"] = env.last_reset_info.get(
                            "opponentModelsApplied"
                        )
                    if args.json_logs:
                        emit_json(episode_payload)
                    else:
                        opp_note = ""
                        if is_battle and args.self_play:
                            opp_note = f" opponents={env.last_reset_info.get('opponentCount')}"
                        elif args.self_play and not is_battle and not args.race_league:
                            opp_note = (
                                f" oppApplied={env.last_reset_info.get('opponentModelsApplied', 0)}"
                            )
                        console.print(
                            "[magenta]episode[/magenta] "
                            f"#{episode_count} step={step} reward={episode_payload['episode_reward']} "
                            f"lap={info.get('lap')} finished={info.get('finished')} "
                            f"progress={episode_payload['progress']}{opp_note}"
                        )
                recent_rewards.append(episode_reward)
                recent_laps.append(float(info.get("lap", 0)))
                recent_finishes.append(1.0 if info.get("finished") else 0.0)
                recent_maps.append(env.map_id)
                recent_chars.append(env.character)
                if args.self_play and not is_battle and args.race_league:
                    league = common.load_league_models(Path(args.league_manifest), args.league_limit, mode=args.mode)
                ep_reset_kwargs = training_reset_kwargs(step, episode_count)
                obs = env.reset_with(**ep_reset_kwargs)
                capture_episode_setup(step, ep_reset_kwargs)
                buffer.start_episode(env.last_base_obs)
                self_play_checked = check_self_play_applied(
                    env, args, console, self_play_checked, len(ep_reset_kwargs["opponent_models"])
                )
                episode_reward = 0.0
                return True

            return False

        def after_transition_hooks(step: int, eps: float) -> None:
            nonlocal last_loss, eval_event_count, latest_eval_report, latest_eval_metrics
            nonlocal latest_attribution, best_eval_reward, elo_store

            if len(buffer) >= args.batch_size and step >= args.learning_starts:
                per_beta = (
                    args.per_beta_start
                    + (args.per_beta_end - args.per_beta_start) * min(1.0, step / args.steps)
                ) if args.prioritized_replay else 0.0
                batch = buffer.sample(args.batch_size, beta=per_beta) if args.prioritized_replay else buffer.sample(args.batch_size)
                if args.prioritized_replay:
                    b_obs, b_actions, b_rewards, b_next_obs, b_dones, is_weights, batch_indices = batch
                else:
                    b_obs, b_actions, b_rewards, b_next_obs, b_dones = batch
                    is_weights = None
                    batch_indices = None
                with torch.no_grad():
                    best_actions = q(b_next_obs).argmax(dim=1, keepdim=True)
                    next_q = target_q(b_next_obs).gather(1, best_actions).squeeze(1)
                    target = b_rewards + (args.gamma ** args.n_step) * (1.0 - b_dones) * next_q
                q_values, baselines, residuals = q.forward_components(b_obs)
                pred = q_values.gather(1, b_actions).squeeze(1)
                td_errors = pred - target
                if is_weights is not None:
                    loss = (is_weights * torch.nn.functional.smooth_l1_loss(pred, target, reduction="none")).mean()
                    buffer.update_priorities(batch_indices, td_errors.detach().cpu().numpy())
                else:
                    loss = torch.nn.functional.smooth_l1_loss(pred, target)
                if args.rdq and args.rdq_beta > 0:
                    rdq_penalty = 0.5 * (
                        baselines.square().mean() + residuals.square().sum(dim=1).mean()
                    )
                    loss = loss + args.rdq_beta * rdq_penalty
                last_loss = float(loss.detach().cpu().item())
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(q.parameters(), args.grad_clip)
                optimizer.step()
                if q._weight_norm:
                    q._project_weights()

            if step % args.target_update == 0:
                target_q.load_state_dict(q.state_dict())

            if step % args.log_every_steps == 0:
                elapsed = max(1e-6, time.perf_counter() - started_at)
                progress_payload = {
                    "event": "progress",
                    "step": step,
                    "steps": args.steps,
                    "pct": round(step / args.steps * 100, 2),
                    "steps_per_sec": round(step / elapsed, 2),
                    "episodes": episode_count,
                    "epsilon": round(eps, 4),
                    "buffer": len(buffer),
                    "loss": None if last_loss is None else round(last_loss, 6),
                    "recent_avg_reward": round(float(np.mean(recent_rewards)), 3) if recent_rewards else None,
                    "recent_avg_laps": round(float(np.mean(recent_laps)), 3) if recent_laps else None,
                    "recent_finish_rate": round(float(np.mean(recent_finishes)), 3) if recent_finishes else None,
                    "recent_q_max": round(float(np.mean(recent_q_max)), 3) if recent_q_max else None,
                    "recent_q_mean": round(float(np.mean(recent_q_mean)), 3) if recent_q_mean else None,
                    "top_action": env.actions[int(np.argmax(recent_action_counts))]["name"]
                    if recent_action_counts.sum() > 0
                    else None,
                    "recent_maps": dict(sorted({m: recent_maps.count(m) for m in set(recent_maps)}.items())),
                    "recent_chars": dict(sorted({c: recent_chars.count(c) for c in set(recent_chars)}.items())),
                }
                if recent_opponent_counts:
                    progress_payload["recent_battle_opponents"] = dict(
                        sorted({c: recent_opponent_counts.count(c) for c in set(recent_opponent_counts)}.items())
                    )
                if args.replay_dtype == "int8" and buffer.clip_events > 0:
                    progress_payload["replay_clip_events"] = buffer.clip_events
                recent_action_counts[:] = 0
                if args.json_logs:
                    emit_json(progress_payload)
                elif progress is not None and task_id is not None:
                    top_action = progress_payload["top_action"] or "-"
                    progress.update(
                        task_id,
                        completed=step,
                        eps=f"{eps:.3f}",
                        loss=common.format_float(last_loss, 4),
                        episodes=f"{episode_count} a:{top_action}",
                    )
                    if args.replay_dtype == "int8" and buffer.clip_events > 0:
                        console.print(
                            f"[yellow]warning[/yellow] replay int8 clip events: {buffer.clip_events}"
                        )

            run_checkpoint = common.should_run_interval(step, args.checkpoint_every)
            run_eval = common.should_run_interval(step, args.eval_every)
            run_elo = args.self_play and common.should_run_interval(step, args.elo_every)
            run_classic_eval = self_play_instrumented and common.should_run_interval(step, classic_eval_every)

            if run_checkpoint or run_elo:
                meta_overrides: dict[str, Any] = {}
                if latest_eval_metrics is not None:
                    meta_overrides["metrics"] = latest_eval_metrics
                if latest_eval_report is not None:
                    meta_overrides["eval"] = latest_eval_report
                if reference_metrics:
                    meta_overrides["reference"] = reference_metrics
                if latest_attribution:
                    meta_overrides["attribution"] = latest_attribution
                export_training_checkpoint(
                    q,
                    env,
                    args,
                    step,
                    checkpoint_pool,
                    checkpoints_exported=checkpoints_exported,
                    meta_overrides=meta_overrides or None,
                )

            if run_eval:
                eval_event_count += 1
                eval_report = evaluate_tracks(eval_env, q, args, eval_step=step)
                track_report = eval_report["tracks"].get(args.map) or next(iter(eval_report["tracks"].values()))
                metrics = track_report[primary_key]
                latest_eval_report = eval_report
                latest_eval_metrics = metrics
                do_smoothgrad = (
                    args.smoothgrad_every > 0
                    and eval_event_count % args.smoothgrad_every == 0
                    and len(buffer) >= args.smoothgrad_samples
                )
                attribution = (
                    common.smoothgrad_attribution(
                        q,
                        buffer,
                        env.obs_keys,
                        n_samples=args.smoothgrad_samples,
                        n_smooth=args.smoothgrad_noise,
                    )
                    if do_smoothgrad
                    else {}
                )
                if attribution:
                    eval_report["attribution"] = attribution
                    latest_attribution = attribution
                if args.json_logs:
                    emit_json({"event": "eval", "eval_step": step, **eval_report, "reference": reference_metrics})
                elif is_battle:
                    common.print_battle_report(console, f"Arena Evaluation @ step {step}", eval_report)
                    if attribution:
                        common.print_attribution_table(console, f"SmoothGrad Attribution @ step {step}", attribution)
                    common.print_action_distribution(
                        console,
                        f"Action Distribution @ step {step}",
                        action_counts,
                        [a["name"] for a in env.actions],
                    )
                else:
                    common.print_eval_report(console, f"Evaluation @ step {step}", eval_report, reference_metrics)
                    if attribution:
                        common.print_attribution_table(console, f"SmoothGrad Attribution @ step {step}", attribution)
                    common.print_action_distribution(
                        console,
                        f"Action Distribution @ step {step}",
                        action_counts,
                        [a["name"] for a in env.actions],
                    )
                if eval_report["avg_reward"] > best_eval_reward:
                    best_eval_reward = eval_report["avg_reward"]

            if run_elo:
                elo_path = Path(args.checkpoint_dir) / f"elo-{args.model_id}.json"
                elo_store = run_elo_rating_round(
                    eval_env,
                    q,
                    args,
                    step=step,
                    checkpoint_name=f"ckpt-{step}",
                    anchors=anchors,
                    checkpoint_pool=checkpoint_pool,
                    elo_store=elo_store,
                    console=console,
                )
                common.save_elo_store(elo_path, elo_store)
                if self_play_instrumented:
                    ladder_entry = run_checkpoint_ladder(
                        eval_env,
                        q,
                        args,
                        step=step,
                        checkpoint_pool=checkpoint_pool,
                        console=console,
                    )
                    if ladder_entry is not None:
                        ladder_history.append(ladder_entry)

            if run_classic_eval:
                classic_baseline_progression.append(
                    run_classic_baseline_eval(eval_env, q, args, step=step, console=console)
                )

        step = 0
        last_policy_sync_step: int | None = None
        while step < args.steps:
            if args.rollout_batch_size == 1:
                step += 1
                eps = epsilon_by_step(step, args.eps_start, args.eps_end, args.eps_decay)
                q_max = None
                q_mean = None
                if random.random() < eps:
                    action = random.randrange(action_dim)
                else:
                    with torch.no_grad():
                        q_values = q(torch.tensor(obs, dtype=torch.float32).unsqueeze(0))
                        q_max = float(torch.max(q_values).detach().cpu().item())
                        q_mean = float(torch.mean(q_values).detach().cpu().item())
                        action = int(torch.argmax(q_values, dim=1).item())
                next_obs, reward, done, info = env.step(action)
                process_transition(
                    step,
                    eps,
                    action,
                    next_obs,
                    env.last_base_obs,
                    reward,
                    done,
                    info,
                    q_max=q_max,
                    q_mean=q_mean,
                )
                after_transition_hooks(step, eps)
            else:
                batch_start = step + 1
                if (
                    last_policy_sync_step is None
                    or step - last_policy_sync_step >= args.rollout_policy_sync_steps
                ):
                    policy_meta = {
                        "frameStack": args.frame_stack,
                        "frameSkip": args.frame_skip,
                        "mode": args.mode,
                    }
                    env.set_rollout_policy(
                        build_compact_dqn_policy(q, env.obs_keys, env.actions, meta=policy_meta)
                    )
                    last_policy_sync_step = step
                transitions_until_sync = (
                    args.rollout_policy_sync_steps - (step - last_policy_sync_step)
                )
                batch_k = min(
                    args.rollout_batch_size,
                    args.steps - step,
                    transitions_until_sync,
                )
                epsilons = [
                    epsilon_by_step(batch_start + i, args.eps_start, args.eps_end, args.eps_decay)
                    for i in range(batch_k)
                ]
                rollout_result = env.rollout(
                    None,
                    epsilons,
                    rollout_seed(args.seed, batch_start),
                    max_steps=batch_k,
                    reuse_cached_policy=True,
                )
                if rollout_result.stopped_reason == "alreadyDone":
                    ep_reset_kwargs = training_reset_kwargs(step, episode_count)
                    obs = env.reset_with(**ep_reset_kwargs)
                    capture_episode_setup(step, ep_reset_kwargs)
                    buffer.start_episode(env.last_base_obs)
                    self_play_checked = check_self_play_applied(
                        env, args, console, self_play_checked, len(ep_reset_kwargs["opponent_models"])
                    )
                    continue

                for i, entry in enumerate(rollout_result.entries):
                    step += 1
                    eps = epsilons[i]
                    process_transition(
                        step,
                        eps,
                        entry.action,
                        entry.stacked_obs,
                        entry.base_obs,
                        entry.reward,
                        entry.done,
                        entry.info,
                        q_max=entry.q_max,
                        q_mean=entry.q_mean,
                    )
                    after_transition_hooks(step, eps)
                    if entry.done:
                        break

        ckpt_history = [
            (h["step"], h["rating"])
            for h in elo_store.get("history", [])
            if str(h.get("name", "")).startswith("ckpt-")
        ]
        final_elo = ckpt_history[-1][1] if ckpt_history else 1000.0
        final_eval_report = evaluate_tracks(eval_env, q, args, eval_step=args.steps)
        final_track_report = final_eval_report["tracks"].get(args.map) or next(
            iter(final_eval_report["tracks"].values())
        )
        final_metrics = final_track_report[primary_key]
        final_attribution = (
            common.smoothgrad_attribution(
                q,
                buffer,
                env.obs_keys,
                n_samples=args.smoothgrad_samples,
                n_smooth=args.smoothgrad_noise,
            )
            if len(buffer) >= args.smoothgrad_samples
            else {}
        )
        if final_attribution:
            final_eval_report["attribution"] = final_attribution
        export_dqn_json(
            q,
            env.obs_keys,
            env.actions,
            Path(args.out),
            {
                "id": args.model_id,
                "name": args.model_name,
                "step": args.steps,
                "mode": args.mode,
                "map": args.map,
                "character": args.character,
                "frameStack": args.frame_stack,
                "frameSkip": args.frame_skip,
                "nStep": args.n_step,
                "activation": args.activation,
                "layerNorm": args.layer_norm,
                "orthogonalInit": args.orthogonal_init,
                "meanExpansionK": args.mean_expansion_k,
                "rdq": args.rdq,
                "rdqBeta": args.rdq_beta if args.rdq else 0.0,
                "advantageCentering": not args.rdq,
                "battleOpponentCurriculum": args.battle_opponent_curriculum,
                "battleOpponentsFixed": args.battle_opponents,
                "rolloutBatchSize": args.rollout_batch_size,
                "rolloutPolicySyncSteps": args.rollout_policy_sync_steps,
                "metrics": final_metrics,
                "eval": final_eval_report,
                "reference": reference_metrics,
                "attribution": final_attribution,
                "elo": final_elo,
                "eloHistory": ckpt_history,
            },
            Path(args.manifest),
        )
        if progress is not None and task_id is not None:
            progress.update(task_id, completed=args.steps)
            progress.stop()
        if args.json_logs:
            print(
                json.dumps({"event": "final_eval", "final_eval": final_metrics, "out": args.out}, indent=2),
                flush=True,
            )
        else:
            if episode_count == 0:
                console.print(
                    "[yellow]No training episode completed before the step budget ended. "
                    "Increase --steps or reduce --frames for more episode-level feedback.[/yellow]"
                )
            if is_battle:
                common.print_battle_report(console, "Final Arena Evaluation", final_eval_report)
            else:
                common.print_eval_report(console, "Final Evaluation", final_eval_report, reference_metrics)
            if final_attribution:
                common.print_attribution_table(console, "Final SmoothGrad Attribution", final_attribution)
            common.print_action_distribution(
                console, "Final Action Distribution", action_counts, [a["name"] for a in env.actions]
            )
            console.print(f"[green]Exported model:[/green] {args.out}")
            if ckpt_history:
                console.print(f"[green]Final Elo:[/green] {final_elo:.1f}  progression={ckpt_history}")
                print_elo_ascii_chart(console, elo_store.get("history", []))
                elo_store_path = Path(args.checkpoint_dir) / f"elo-{args.model_id}.json"
                elo_png = f"elo-{args.model_id}.png"
                try:
                    subprocess.run(
                        ["uv", "run", "plot_elo.py", "--store", str(elo_store_path), "--out", elo_png],
                        check=True,
                        capture_output=True,
                        timeout=300,
                    )
                    console.print(f"[green]Elo chart written:[/green] {elo_png}")
                except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
                    console.print(f"[yellow]Could not render Elo chart PNG: {exc}[/yellow]")
            if classic_baseline_progression:
                progression_text = ", ".join(
                    f"({p['step']},{p['win_rate']:.2f})" for p in classic_baseline_progression
                )
                console.print(f"[green]Classic baseline progression:[/green] {progression_text}")
                print_classic_baseline_ascii_chart(
                    console, classic_baseline_progression, mode=args.mode
                )
                classic_data_path = Path(f"classic-baseline-{args.model_id}.json")
                classic_data_path.write_text(
                    json.dumps({"progression": classic_baseline_progression}, indent=2),
                    encoding="utf-8",
                )
                classic_png = f"classic-baseline-{args.model_id}.png"
                try:
                    subprocess.run(
                        [
                            "uv",
                            "run",
                            "plot_classic_baseline.py",
                            "--data",
                            str(classic_data_path),
                            "--out",
                            classic_png,
                        ],
                        check=True,
                        capture_output=True,
                        timeout=300,
                    )
                    console.print(f"[green]Classic baseline chart written:[/green] {classic_png}")
                except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
                    console.print(f"[yellow]Could not render classic baseline chart PNG: {exc}[/yellow]")
                finally:
                    with contextlib.suppress(OSError):
                        classic_data_path.unlink()
            if ladder_history:
                print_ladder_table(console, ladder_history)
            if self_play_instrumented and matchups_path.exists():
                matchup_stats, matchup_elo = compute_matchup_stats(matchups_path)
                print_matchup_ranking_table(console, matchup_stats, matchup_elo)
        eval_env.close()
        env.close()
        if eval_page is not None:
            eval_page.close()
        if browser is not None:
            browser.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backend",
        choices=["browser", "node"],
        default="browser",
        help="Simulation backend: Playwright Chromium (browser) or Node stdio sim-server (node).",
    )
    parser.add_argument(
        "--benchmark",
        type=int,
        default=0,
        help="If >0, run this many rollout-batched env steps with a random policy and print JSON throughput stats.",
    )
    parser.add_argument("--index", default="index.html")
    parser.add_argument(
        "--mode",
        choices=["race", "battle"],
        default="race",
        help="Training environment: 'race' (checkpoints/laps) or 'battle' (arena free-for-all).",
    )
    parser.add_argument("--arena-map", default="battle_arena", help="Map id used when --mode battle.")
    parser.add_argument("--out", default="models/dqn-latest.json")
    parser.add_argument("--manifest", default="models/manifest.json")
    parser.add_argument("--model-id", default="dqn-latest")
    parser.add_argument("--model-name", default="DQN Latest")
    parser.add_argument("--checkpoint-dir", default="models/checkpoints")
    parser.add_argument("--map", default="core_mainframe")
    parser.add_argument(
        "--maps",
        default="core_mainframe,audit_super_ring,compliance_chicane,black_ice_data_vault,protocol_amendment_labyrinth",
    )
    parser.add_argument("--random-map", action="store_true")
    parser.add_argument(
        "--eval-maps",
        default="core_mainframe,audit_super_ring,compliance_chicane,black_ice_data_vault,protocol_amendment_labyrinth",
    )
    parser.add_argument("--character", default="florian")
    parser.add_argument("--characters", default="anton,artur,rissal,pia,florian")
    parser.add_argument("--random-character", action="store_true")
    parser.add_argument("--frame-stack", type=int, default=4)
    parser.add_argument("--frame-skip", type=int, default=6)
    parser.add_argument("--frames", type=int, default=7200)
    parser.add_argument("--steps", type=int, default=300_000)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--activation", choices=["tanh", "gelu", "relu"], default="tanh")
    parser.add_argument("--layer-norm", action="store_true")
    parser.add_argument("--l2-norm", action="store_true")
    parser.add_argument("--weight-norm", action="store_true")
    parser.add_argument("--orthogonal-init", dest="orthogonal_init", action="store_true")
    parser.add_argument("--no-orthogonal-init", dest="orthogonal_init", action="store_false")
    parser.add_argument(
        "--mean-expansion-k",
        type=float,
        default=0.0,
        help="Mean-expansion output scale k; 0 disables implicit-baseline DQN.",
    )
    parser.add_argument(
        "--rdq",
        action="store_true",
        help="Use Regularized Dueling Q-learning: Q=B+Z without advantage centering.",
    )
    parser.add_argument(
        "--rdq-beta",
        type=float,
        default=0.001,
        help="RDQ L2 penalty coefficient for baseline and residual outputs.",
    )
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--prioritized-replay", action="store_true")
    parser.add_argument(
        "--replay-dtype",
        choices=["float16", "int8", "float32"],
        default="float16",
        help="Storage dtype for frame replay buffer (base frames only).",
    )
    parser.add_argument("--per-alpha", type=float, default=0.6)
    parser.add_argument("--per-beta-start", type=float, default=0.4)
    parser.add_argument("--per-beta-end", type=float, default=1.0)
    parser.add_argument("--buffer-size", type=int, default=100_000)
    parser.add_argument("--learning-starts", type=int, default=2_000)
    parser.add_argument("--target-update", type=int, default=1_000)
    parser.add_argument("--checkpoint-every", type=int, default=25_000)
    parser.add_argument("--eval-every", type=int, default=100_000)
    parser.add_argument("--episodes-eval", type=int, default=1)
    parser.add_argument("--elo-every", type=int, default=100_000, help="Interim Elo interval; 0 disables.")
    parser.add_argument(
        "--classic-eval-every",
        type=int,
        default=0,
        help="Classic-only baseline eval interval in race self-play; 0 uses --elo-every.",
    )
    parser.add_argument(
        "--classic-eval-episodes",
        type=int,
        default=8,
        help="Episodes per classic baseline eval (greedy policy vs classic-only opponents).",
    )
    parser.add_argument(
        "--ladder-duels",
        type=int,
        default=6,
        help="1v1 duels between newest and previous checkpoint each Elo round; 0 disables.",
    )
    parser.add_argument(
        "--smoothgrad-every",
        type=int,
        default=0,
        help="Run SmoothGrad every N evaluation events; 0 disables interim SmoothGrad.",
    )
    parser.add_argument("--smoothgrad-samples", type=int, default=200)
    parser.add_argument(
        "--smoothgrad-noise",
        type=int,
        default=30,
        help="SmoothGrad smoothing iterations (n_smooth).",
    )
    parser.add_argument("--reference-episodes", type=int, default=2)
    parser.add_argument("--log-every-episodes", type=int, default=10)
    parser.add_argument("--log-every-steps", type=int, default=1_000)
    parser.add_argument("--json-logs", action="store_true", help="Emit JSON lines instead of Rich progress output")
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--n-step", type=int, default=1, help="N-step return horizon for replay sampling.")
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--grad-clip", type=float, default=10.0)
    parser.add_argument("--eps-start", type=float, default=1.0)
    parser.add_argument("--eps-end", type=float, default=0.05)
    parser.add_argument("--eps-decay", type=int, default=30_000)
    parser.add_argument(
        "--rollout-batch-size",
        type=int,
        default=8,
        help="Steps per JS rollout batch (default 8) using cached compact JS policy "
        "inference. Use 1 for exact legacy per-step Python epsilon-greedy + rlStep.",
    )
    parser.add_argument(
        "--rollout-policy-sync-steps",
        type=int,
        default=32,
        help="For batch mode, sync compact policy weights to JS every N completed "
        "transitions (default 32; max policy staleness N-1 optimizer updates). "
        "Has no effect with --rollout-batch-size 1.",
    )
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--solo", action="store_true", default=True)
    parser.add_argument("--with-opponents", dest="solo", action="store_false")
    parser.add_argument("--no-items", action="store_true", default=True)
    parser.add_argument("--with-items", dest="no_items", action="store_false")
    parser.add_argument("--no-hazards", action="store_true", default=True)
    parser.add_argument("--with-hazards", dest="no_hazards", action="store_false")
    parser.add_argument("--self-play", action="store_true")
    parser.add_argument("--league-manifest", default="models/manifest.json")
    parser.add_argument("--league-limit", type=int, default=16)
    parser.add_argument("--league-opponents", type=int, default=3)
    parser.add_argument("--league-recency-tau", type=float, default=4.0)
    parser.add_argument("--classic-opponent-prob", type=float, default=0.25)
    parser.add_argument(
        "--anchor-models",
        default=BATTLE_DEFAULT_ANCHORS,
        help="Comma-separated manifest ids used as fixed anchor opponents (Elo eval only). "
        f"Race default: {RACE_DEFAULT_ANCHORS}.",
    )
    parser.add_argument(
        "--checkpoint-pool-size",
        type=int,
        default=8,
        help="How many recent own checkpoints stay in the self-play pool (battle/race).",
    )
    parser.add_argument(
        "--race-opponents",
        type=int,
        default=3,
        help="Opponent kart slots for race checkpoint-pool self-play (default 3).",
    )
    parser.add_argument(
        "--race-classic-prob",
        type=float,
        default=0.25,
        help="Probability a race self-play episode includes one classic AI slot. "
        "0 = pure self-play; classic still fills slots while the checkpoint pool is empty.",
    )
    parser.add_argument(
        "--race-league",
        action="store_true",
        help="Use manifest league sampling for race self-play instead of checkpoint pool.",
    )
    parser.add_argument(
        "--race-position-reward",
        action="store_true",
        help="Add terminal position bonus in race mode (+30/+15/0/-10 for ranks 1/2/3/4+).",
    )
    parser.add_argument(
        "--elo-map",
        default="core_mainframe",
        help="Fixed map for race-mode Elo duels (battle uses --arena-map).",
    )
    parser.add_argument(
        "--rating-episodes",
        type=int,
        default=1,
        help="Duel episodes per rated opponent at each checkpoint.",
    )
    parser.add_argument(
        "--rating-recent-checkpoints",
        type=int,
        default=1,
        help="How many most-recent previous checkpoints join the Elo rating set.",
    )
    parser.add_argument("--elo-k", type=float, default=32.0, help="Elo K-factor for checkpoint rating duels.")
    parser.add_argument(
        "--train-classic-prob",
        type=float,
        default=0.35,
        help="Probability a training episode includes one classic AI (battle self-play). "
        "0 = pure self-play; classic still fills slots while the checkpoint pool is empty.",
    )
    parser.add_argument(
        "--train-anchor-prob",
        type=float,
        default=0.35,
        help="Probability a training episode includes one anchor model (battle self-play). "
        "0 = never train against anchors; they remain Elo eval opponents only.",
    )
    parser.add_argument(
        "--battle-opponent-curriculum",
        default=common.BATTLE_OPPONENT_CURRICULUM_DEFAULT,
        help="Comma-separated phase schedule <fraction>:<count> for battle self-play opponent counts.",
    )
    parser.add_argument(
        "--battle-opponents",
        type=int,
        default=None,
        help="Fixed battle opponent count (1..7); bypasses curriculum when set.",
    )
    parser.add_argument("--no-auto-install-browser", dest="auto_install_browser", action="store_false")
    parser.add_argument("--install-browser-only", action="store_true")
    parser.set_defaults(auto_install_browser=True, orthogonal_init=True)
    return parser.parse_args()


if __name__ == "__main__":
    parsed_args = parse_args()
    parsed_args.battle_opponents = common.validate_battle_opponents_fixed(parsed_args.battle_opponents)
    parsed_args.battle_opponent_curriculum_parsed = common.parse_battle_opponent_curriculum(
        parsed_args.battle_opponent_curriculum
    )
    if parsed_args.install_browser_only:
        subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
    else:
        train(parsed_args)
