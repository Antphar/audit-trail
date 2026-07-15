# /// script
# dependencies = [
#   "numpy>=1.26",
#   "playwright>=1.40",
#   "rich>=13.0",
#   "torch>=2.2",
# ]
# ///
"""Shared RL training utilities for Turbo Kart Dash agents (DQN, SAC, etc.)."""

from __future__ import annotations

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
import torch
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn, TimeRemainingColumn
from rich.table import Table


@dataclass
class Transition:
    obs: np.ndarray
    action: int | np.ndarray
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
        if isinstance(batch[0].action, (int, np.integer)):
            actions = torch.tensor([t.action for t in batch], dtype=torch.int64).unsqueeze(1)
        else:
            actions = torch.tensor(np.stack([t.action for t in batch]), dtype=torch.float32)
        rewards = torch.tensor([t.reward for t in batch], dtype=torch.float32)
        next_obs = torch.tensor(np.stack([t.next_obs for t in batch]), dtype=torch.float32)
        dones = torch.tensor([t.done for t in batch], dtype=torch.float32)
        return obs, actions, rewards, next_obs, dones


class PrioritizedReplayBuffer:
    def __init__(self, capacity: int, alpha: float = 0.6):
        self._capacity = capacity
        self._alpha = alpha
        self._data: list[Transition | None] = [None] * capacity
        self._priorities = np.zeros(capacity, dtype=np.float64)
        self._pos = 0
        self._size = 0
        self._max_priority = 1.0

    @property
    def data(self) -> list[Transition]:
        return [t for t in self._data[: self._size] if t is not None]

    def __len__(self) -> int:
        return self._size

    def add(self, transition: Transition) -> None:
        self._data[self._pos] = transition
        self._priorities[self._pos] = self._max_priority**self._alpha
        self._pos = (self._pos + 1) % self._capacity
        self._size = min(self._size + 1, self._capacity)

    def sample(
        self, batch_size: int, beta: float = 0.4
    ) -> tuple[torch.Tensor, ...]:
        priorities = self._priorities[: self._size]
        probs = priorities / priorities.sum()
        indices = np.random.choice(self._size, size=batch_size, p=probs, replace=False)

        total = self._size
        weights = (total * probs[indices]) ** (-beta)
        weights /= weights.max()
        weights_t = torch.tensor(weights, dtype=torch.float32)

        batch = [self._data[i] for i in indices]
        obs = torch.tensor(np.stack([t.obs for t in batch]), dtype=torch.float32)
        if isinstance(batch[0].action, (int, np.integer)):
            actions = torch.tensor([t.action for t in batch], dtype=torch.int64).unsqueeze(1)
        else:
            actions = torch.tensor(np.stack([t.action for t in batch]), dtype=torch.float32)
        rewards = torch.tensor([t.reward for t in batch], dtype=torch.float32)
        next_obs = torch.tensor(np.stack([t.next_obs for t in batch]), dtype=torch.float32)
        dones = torch.tensor([t.done for t in batch], dtype=torch.float32)
        return obs, actions, rewards, next_obs, dones, weights_t, indices

    def update_priorities(self, indices: np.ndarray, td_errors: np.ndarray) -> None:
        priorities = (np.abs(td_errors) + 1e-6) ** self._alpha
        for idx, p in zip(indices, priorities):
            self._priorities[idx] = p
            self._max_priority = max(self._max_priority, float(p))


def _next_power_of_two(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


class _SumTree:
    """Fixed-capacity sum tree for O(log N) prioritized replay sampling.

    Leaves are keyed by ring-buffer slot indices ``0 .. capacity-1``.  Slots with
    zero mass are never sampled.  Stratified prefix-sum sampling draws one index
    per equal-mass segment of ``[0, total)`` **with replacement** (standard
    stratified PER); this differs from without-replacement ``np.random.choice``.
    """

    def __init__(self, capacity: int):
        self._capacity = capacity
        self._tree_size = _next_power_of_two(capacity)
        self._leaf_offset = self._tree_size - 1
        self.tree = np.zeros(2 * self._tree_size - 1, dtype=np.float64)

    @property
    def nbytes(self) -> int:
        return self.tree.nbytes

    def set(self, index: int, value: float) -> None:
        if not 0 <= index < self._capacity:
            raise IndexError(f"slot {index} out of range [0, {self._capacity})")
        leaf = self._leaf_offset + index
        change = value - self.tree[leaf]
        self.tree[leaf] = value
        while leaf > 0:
            parent = (leaf - 1) // 2
            self.tree[parent] += change
            leaf = parent

    def total(self) -> float:
        return float(self.tree[0])

    def get(self, index: int) -> float:
        if not 0 <= index < self._capacity:
            raise IndexError(f"slot {index} out of range [0, {self._capacity})")
        return float(self.tree[self._leaf_offset + index])

    def _retrieve(self, cum: float) -> int:
        total = self.total()
        if not 0.0 <= cum < total:
            raise ValueError(f"prefix sum must be in [0, {total}), got {cum}")
        idx = 0
        while idx < self._leaf_offset:
            left = 2 * idx + 1
            if cum < self.tree[left]:
                idx = left
            else:
                cum -= self.tree[left]
                idx = left + 1
        index = idx - self._leaf_offset
        if index >= self._capacity:
            raise RuntimeError(f"sum tree returned padded leaf {index}")
        return index

    def stratified_sample(self, batch_size: int) -> np.ndarray:
        total = self.total()
        if total <= 0.0:
            raise ValueError("Cannot sample from empty sum tree")
        segment = total / batch_size
        indices = np.empty(batch_size, dtype=np.intp)
        for i in range(batch_size):
            cum = segment * (i + random.random())
            indices[i] = self._retrieve(cum)
        return indices


class FrameReplayBuffer:
    """Stores single base frames at reduced precision; reconstructs frame stacks on sample.

    Memory layout:
      frames:     np.ndarray (capacity, base_dim) dtype float16 (or int8, scaled by 127 over [-1,1])
      episodes:   np.ndarray (capacity,) uint32   — episode id per frame
      frame_ids:  np.ndarray (capacity,) uint64   — unique chronological id per frame
      actions:    np.ndarray (capacity,) int16
      rewards:    np.ndarray (capacity,) float32
      dones:      np.ndarray (capacity,) bool
      valid:      np.ndarray (capacity,) bool     — slot holds a one-step transition record
      sampleable: np.ndarray (capacity,) bool     — slot is an n-step (or terminal-truncated) anchor

    ``__len__`` returns the count of *sampleable* anchors (gates training/sampling).

    Ring invalidation: overwriting slot *p* clears ``valid[p]`` and ``sampleable[p]`` and zeros
    the sum-tree leaf.  When *p* is overwritten without a matching ``add()`` (e.g.
    ``start_episode``), ``valid[p-1]`` / ``sampleable[p-1]`` are cleared too because that
    transition's next frame lived at *p*.  During ``add()``, the next frame write at *p*
    intentionally completes the transition at *p-1*, so *p-1* is preserved.
    """

    def __init__(
        self,
        capacity: int,
        base_dim: int,
        frame_stack: int,
        stack_mask: np.ndarray | None,
        dtype: str = "float16",
        alpha: float | None = None,
        n_step: int = 1,
        gamma: float = 0.99,
    ):
        if n_step < 1:
            raise ValueError(f"n_step must be >= 1, got {n_step}")
        if not 0.0 <= gamma <= 1.0:
            raise ValueError(f"gamma must be in [0, 1], got {gamma}")
        self._capacity = capacity
        self._base_dim = base_dim
        self._frame_stack = max(1, int(frame_stack))
        self._stack_mask = stack_mask
        self._stacked_dim = int(stack_mask.shape[0]) if stack_mask is not None else base_dim * self._frame_stack
        self._dtype_name = dtype
        self._alpha = alpha
        self._n_step = int(n_step)
        self._gamma = float(gamma)
        self._int8 = dtype == "int8"
        if dtype == "int8":
            self.frames = np.zeros((capacity, base_dim), dtype=np.int8)
        elif dtype == "float32":
            self.frames = np.zeros((capacity, base_dim), dtype=np.float32)
        else:
            self.frames = np.zeros((capacity, base_dim), dtype=np.float16)
        self.episodes = np.zeros(capacity, dtype=np.uint32)
        self.frame_ids = np.zeros(capacity, dtype=np.uint64)
        self.actions = np.zeros(capacity, dtype=np.int16)
        self.rewards = np.zeros(capacity, dtype=np.float32)
        self.dones = np.zeros(capacity, dtype=bool)
        self.valid = np.zeros(capacity, dtype=bool)
        self.sampleable = np.zeros(capacity, dtype=bool)
        self._sum_tree = _SumTree(capacity) if alpha is not None else None
        self._max_priority = 1.0
        self._write_pos = 0
        self._size = 0
        self._n_valid = 0
        self._n_sampleable = 0
        self._episode_id = 0
        self._current_episode = 0
        self._next_frame_id = 0
        self.clip_events = 0

    @property
    def memory_bytes(self) -> int:
        total = (
            self.frames.nbytes
            + self.episodes.nbytes
            + self.frame_ids.nbytes
            + self.actions.nbytes
            + self.rewards.nbytes
            + self.dones.nbytes
            + self.valid.nbytes
            + self.sampleable.nbytes
        )
        if self._sum_tree is not None:
            total += self._sum_tree.nbytes
        return total

    def __len__(self) -> int:
        return self._n_sampleable

    def _encode(self, obs: np.ndarray) -> np.ndarray:
        obs = np.asarray(obs, dtype=np.float32)
        if self._int8:
            if np.any(np.abs(obs) > 1.001):
                self.clip_events += 1
            obs = np.clip(obs, -1.0, 1.0)
            return np.round(obs * 127.0).astype(np.int8)
        if self._dtype_name == "float32":
            return obs.astype(np.float32)
        return obs.astype(np.float16)

    def _dequantize(self, arr: np.ndarray) -> np.ndarray:
        if self._int8:
            return arr.astype(np.float32) / 127.0
        return arr.astype(np.float32)

    def _invalidate_slot(self, p: int, *, invalidate_prev: bool = True) -> None:
        if self.valid[p]:
            self.valid[p] = False
            self._n_valid -= 1
        if self.sampleable[p]:
            self.sampleable[p] = False
            self._n_sampleable -= 1
            if self._sum_tree is not None:
                self._sum_tree.set(p, 0.0)
        if invalidate_prev:
            prev = (p - 1) % self._capacity
            if self.valid[prev]:
                self.valid[prev] = False
                self._n_valid -= 1
            if self.sampleable[prev]:
                self.sampleable[prev] = False
                self._n_sampleable -= 1
                if self._sum_tree is not None:
                    self._sum_tree.set(prev, 0.0)
        self._refresh_anchors_near(p)

    def _set_sampleable(self, anchor: int, sampleable: bool) -> None:
        if sampleable and not self.sampleable[anchor]:
            self.sampleable[anchor] = True
            self._n_sampleable += 1
            if self._sum_tree is not None:
                self._sum_tree.set(anchor, self._max_priority**self._alpha)
        elif not sampleable and self.sampleable[anchor]:
            self.sampleable[anchor] = False
            self._n_sampleable -= 1
            if self._sum_tree is not None:
                self._sum_tree.set(anchor, 0.0)

    def _evaluate_anchor(self, anchor: int) -> tuple[bool, float, bool, int]:
        episode_id = int(self.episodes[anchor])
        anchor_frame_id = int(self.frame_ids[anchor])
        total_reward = 0.0
        gamma_pow = 1.0
        for step in range(self._n_step):
            slot = (anchor + step) % self._capacity
            if not self.valid[slot]:
                return False, 0.0, False, 0
            if int(self.episodes[slot]) != episode_id:
                return False, 0.0, False, 0
            if int(self.frame_ids[slot]) != anchor_frame_id + step:
                return False, 0.0, False, 0
            total_reward += gamma_pow * float(self.rewards[slot])
            if self.dones[slot]:
                next_anchor = (slot + 1) % self._capacity
                if int(self.episodes[next_anchor]) != episode_id:
                    return False, 0.0, False, 0
                if int(self.frame_ids[next_anchor]) != anchor_frame_id + step + 1:
                    return False, 0.0, False, 0
                return True, total_reward, True, next_anchor
            gamma_pow *= self._gamma
        next_anchor = (anchor + self._n_step) % self._capacity
        if int(self.episodes[next_anchor]) != episode_id:
            return False, 0.0, False, 0
        if int(self.frame_ids[next_anchor]) != anchor_frame_id + self._n_step:
            return False, 0.0, False, 0
        return True, total_reward, False, next_anchor

    def _refresh_anchors_near(self, end_slot: int) -> None:
        for offset in range(self._n_step):
            anchor = (end_slot - offset) % self._capacity
            ok, _, _, _ = self._evaluate_anchor(anchor)
            self._set_sampleable(anchor, ok)

    def _write_frame(self, base_obs: np.ndarray, episode_id: int, *, invalidate_prev: bool = False) -> None:
        p = self._write_pos
        if self._size == self._capacity:
            self._invalidate_slot(p, invalidate_prev=invalidate_prev)
        self.frames[p] = self._encode(base_obs)
        self.episodes[p] = episode_id
        self.frame_ids[p] = self._next_frame_id
        self._next_frame_id += 1
        self.valid[p] = False
        self._write_pos = (p + 1) % self._capacity
        self._size = min(self._size + 1, self._capacity)

    def start_episode(self, base_obs: np.ndarray) -> None:
        self._episode_id += 1
        self._current_episode = self._episode_id
        self._write_frame(base_obs, self._current_episode, invalidate_prev=True)

    def add(self, base_obs_next: np.ndarray, action: int, reward: float, done: bool) -> None:
        prev = (self._write_pos - 1) % self._capacity
        self.actions[prev] = action
        self.rewards[prev] = reward
        self.dones[prev] = done
        if not self.valid[prev]:
            self.valid[prev] = True
            self._n_valid += 1
        self._write_frame(base_obs_next, self._current_episode)
        self._refresh_anchors_near(prev)

    def _sampleable_indices(self) -> np.ndarray:
        return np.flatnonzero(self.sampleable)

    def _stack_index_matrix(self, anchors: np.ndarray, episode_ids: np.ndarray) -> np.ndarray:
        cap = self._capacity
        batch = anchors.shape[0]
        idx_matrix = np.empty((batch, self._frame_stack), dtype=np.intp)
        anchor_frame_ids = self.frame_ids[anchors]
        contiguous = np.ones(batch, dtype=bool)
        for lag in range(self._frame_stack):
            raw_idx = (anchors - lag) % cap
            if lag == 0:
                idx_matrix[:, 0] = raw_idx
                earliest = raw_idx.copy()
            else:
                same_ep = self.episodes[raw_idx] == episode_ids
                has_history = anchor_frame_ids >= lag
                expected_ids = np.zeros(batch, dtype=np.uint64)
                expected_ids[has_history] = anchor_frame_ids[has_history] - lag
                contiguous &= (
                    has_history
                    & same_ep
                    & (self.frame_ids[raw_idx] == expected_ids)
                )
                earliest = np.where(contiguous, raw_idx, earliest)
                idx_matrix[:, lag] = earliest
        return idx_matrix

    def _reconstruct_stacks(
        self, anchors: np.ndarray, next_anchors: np.ndarray | None = None
    ) -> tuple[np.ndarray, np.ndarray]:
        episode_ids = self.episodes[anchors]
        obs_idx = self._stack_index_matrix(anchors, episode_ids)
        if next_anchors is None:
            next_anchors = (anchors + 1) % self._capacity
        next_idx = self._stack_index_matrix(next_anchors, episode_ids)

        obs_raw = self.frames[obs_idx]
        next_raw = self.frames[next_idx]
        batch = anchors.shape[0]
        obs_full = obs_raw.reshape(batch, self._frame_stack * self._base_dim)
        next_full = next_raw.reshape(batch, self._frame_stack * self._base_dim)
        if self._stack_mask is not None:
            obs_full = obs_full[:, self._stack_mask]
            next_full = next_full[:, self._stack_mask]
        return self._dequantize(obs_full), self._dequantize(next_full)

    def _batch_chain_info(self, indices: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        batch = indices.shape[0]
        rewards = np.empty(batch, dtype=np.float32)
        dones = np.empty(batch, dtype=bool)
        next_anchors = np.empty(batch, dtype=np.intp)
        for i, anchor in enumerate(indices):
            ok, total_reward, done, next_anchor = self._evaluate_anchor(int(anchor))
            if not ok:
                raise ValueError(f"sampled non-sampleable anchor {anchor}")
            rewards[i] = total_reward
            dones[i] = done
            next_anchors[i] = next_anchor
        return rewards, dones, next_anchors

    def sample(self, batch_size: int, beta: float = 0.4) -> tuple[torch.Tensor, ...]:
        if self._n_sampleable < batch_size:
            raise ValueError(
                f"Not enough sampleable transitions: {self._n_sampleable} < {batch_size}"
            )
        if self._sum_tree is not None:
            indices = self._sum_tree.stratified_sample(batch_size)
            total = self._n_sampleable
            probs = np.array([self._sum_tree.get(int(i)) for i in indices], dtype=np.float64)
            probs /= self._sum_tree.total()
            weights = (total * probs) ** (-beta)
            weights /= weights.max()
            weights_t = torch.tensor(weights, dtype=torch.float32)
        else:
            sampleable_idx = self._sampleable_indices()
            indices = np.random.choice(sampleable_idx, size=batch_size, replace=False)
            weights_t = None

        rewards, dones, next_anchors = self._batch_chain_info(indices)
        obs, next_obs = self._reconstruct_stacks(indices, next_anchors)
        actions = torch.tensor(self.actions[indices], dtype=torch.int64).unsqueeze(1)
        rewards_t = torch.tensor(rewards, dtype=torch.float32)
        dones_t = torch.tensor(dones, dtype=torch.float32)
        obs_t = torch.tensor(obs, dtype=torch.float32)
        next_obs_t = torch.tensor(next_obs, dtype=torch.float32)
        if weights_t is not None:
            return obs_t, actions, rewards_t, next_obs_t, dones_t, weights_t, indices
        return obs_t, actions, rewards_t, next_obs_t, dones_t

    def update_priorities(self, indices: np.ndarray, td_errors: np.ndarray) -> None:
        if self._sum_tree is None or self._alpha is None:
            return
        raw = np.abs(td_errors) + 1e-6
        for idx, priority in zip(indices, raw):
            slot = int(idx)
            self._max_priority = max(self._max_priority, float(priority))
            self._sum_tree.set(slot, float(priority) ** self._alpha)

    def sample_obs(self, n: int) -> np.ndarray:
        if self._n_sampleable < n:
            raise ValueError(
                f"Not enough sampleable transitions: {self._n_sampleable} < {n}"
            )
        sampleable_idx = self._sampleable_indices()
        indices = np.random.choice(sampleable_idx, size=n, replace=False)
        obs, _ = self._reconstruct_stacks(indices)
        return obs


@dataclass
class RolloutEntry:
    base_obs: np.ndarray
    stacked_obs: np.ndarray
    action: int
    reward: float
    done: bool
    info: dict[str, Any]
    q_max: float | None
    q_mean: float | None


@dataclass
class RolloutResult:
    entries: list[RolloutEntry]
    stopped_reason: str
    count: int


class TurboKartEnv:
    def __init__(
        self,
        page: Page,
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
        classic_opponent_slots: int = 0,
        mode: str = "race",
    ):
        self.page = page
        self.mode = "battle" if str(mode).lower() in ("battle", "arena") else "race"
        flags = [
            "headless=1",
            "external=1",
            f"mode={self.mode}",
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
        self.classic_opponent_slots = max(0, int(classic_opponent_slots))
        self.opponent_count: int | None = None
        self.last_reset_info: dict[str, Any] = {}
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
        classic_opponent_slots: int | None = None,
        opponent_count: int | None = None,
    ) -> np.ndarray:
        if map_id is not None:
            self.map_id = map_id
        if character is not None:
            self.character = character
        if opponent_models is not None:
            self.opponent_models = opponent_models
        if classic_opponent_slots is not None:
            self.classic_opponent_slots = max(0, int(classic_opponent_slots))
        # Per-call, not sticky: a 1v1 rating duel must not leak its opponent count
        # into subsequent baseline evals on the same env.
        self.opponent_count = max(0, int(opponent_count)) if opponent_count is not None else None
        cfg: dict[str, Any] = {
            "mode": self.mode,
            "map": self.map_id,
            "character": self.character,
            "frames": self.frames,
            "solo": self.solo,
            "noItems": self.no_items,
            "noHazards": self.no_hazards,
            "frameSkip": self.frame_skip,
            "opponentModels": self.opponent_models,
            "classicOpponentSlots": self.classic_opponent_slots,
        }
        if self.opponent_count is not None:
            cfg["opponentCount"] = self.opponent_count
        result = self.page.evaluate("""(cfg) => window.rlReset(cfg)""", cfg)
        self.last_reset_info = dict(result.get("info", {}))
        self._base_keys = result["obsKeys"]
        self.obs_keys = self._stack_keys(self._base_keys)
        self.actions = result["actions"]
        return self._stack_obs(np.asarray(result["obs"], dtype=np.float32), reset=True)

    def step(self, action) -> tuple[np.ndarray, float, bool, dict[str, Any]]:
        if isinstance(action, (int, np.integer)):
            result = self.page.evaluate("(a) => window.rlStep(a)", int(action))
        elif isinstance(action, dict):
            result = self.page.evaluate("(a) => window.rlStep(a)", action)
        else:
            action_list = [float(x) for x in action]
            result = self.page.evaluate("(a) => window.rlStep(a)", action_list)
        obs = self._stack_obs(np.asarray(result["obs"], dtype=np.float32))
        reward = float(result["reward"])
        done = bool(result["done"])
        info = dict(result["info"])
        return obs, reward, done, info

    def set_rollout_policy(self, policy: dict[str, Any]) -> None:
        self.page.evaluate("""(p) => window.rlSetRolloutPolicy(p)""", policy)

    def rollout(
        self,
        policy: dict[str, Any] | None,
        epsilons: list[float],
        seed: int,
        *,
        max_steps: int | None = None,
        reuse_cached_policy: bool = False,
    ) -> RolloutResult:
        if not reuse_cached_policy:
            if policy is None:
                raise ValueError("policy is required unless reuse_cached_policy=True")
            self.set_rollout_policy(policy)
        config = {
            "epsilons": [float(e) for e in epsilons],
            "seed": int(seed) & 0xFFFFFFFF,
            "maxSteps": int(max_steps if max_steps is not None else len(epsilons)),
        }
        result = self.page.evaluate("""(cfg) => window.rlRollout(cfg)""", config)
        stopped_reason = str(result.get("stoppedReason", ""))
        if stopped_reason == "alreadyDone":
            return RolloutResult(entries=[], stopped_reason="alreadyDone", count=0)

        trajectory = result.get("trajectory") or []
        if not trajectory:
            raise RuntimeError(f"Unexpected empty rollout (stoppedReason={stopped_reason!r})")

        entries: list[RolloutEntry] = []
        for item in trajectory:
            raw_obs = np.asarray(item["obs"], dtype=np.float32)
            stacked_obs = self._stack_obs(raw_obs)
            q_max = item.get("qMax")
            q_mean = item.get("qMean")
            entries.append(
                RolloutEntry(
                    base_obs=raw_obs.copy(),
                    stacked_obs=stacked_obs,
                    action=int(item["action"]),
                    reward=float(item["reward"]),
                    done=bool(item["done"]),
                    info=dict(item.get("info", {})),
                    q_max=float(q_max) if q_max is not None and math.isfinite(q_max) else None,
                    q_mean=float(q_mean) if q_mean is not None and math.isfinite(q_mean) else None,
                )
            )
        return RolloutResult(
            entries=entries,
            stopped_reason=stopped_reason,
            count=int(result.get("count", len(entries))),
        )


def smoothgrad_attribution(
    model: torch.nn.Module,
    buffer: ReplayBuffer,
    obs_keys: list[str],
    *,
    n_samples: int = 200,
    n_smooth: int = 30,
    noise_std: float = 0.1,
    output_fn=None,
) -> dict[str, float]:
    if len(buffer) < n_samples:
        return {}
    if hasattr(buffer, "sample_obs"):
        obs_batch = torch.tensor(buffer.sample_obs(n_samples), dtype=torch.float32)
    else:
        batch = random.sample(buffer.data, n_samples)
        obs_batch = torch.tensor(np.stack([t.obs for t in batch]), dtype=torch.float32)
    obs_batch.requires_grad_(True)

    attributions = torch.zeros(obs_batch.shape[1])
    for _ in range(n_smooth):
        noisy = (obs_batch + torch.randn_like(obs_batch) * noise_std).detach()
        noisy.requires_grad_(True)
        out = model(noisy)
        if output_fn is not None:
            scalar = output_fn(out)
        else:
            scalar = out.max(dim=1).values.sum()
        scalar.backward()
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
    console.print(f"  [dim]{total} features total · showing top {min(top_n, total)} + bottom {min(bottom_n, len(bottom_items))}[/dim]")


def print_action_distribution(
    console: Console,
    title: str,
    action_counts: np.ndarray,
    action_names: list[str],
) -> None:
    total = int(action_counts.sum())
    if total == 0:
        return
    table = Table(title=title)
    table.add_column("Action", style="cyan")
    table.add_column("Count", justify="right")
    table.add_column("%", justify="right", style="yellow")
    table.add_column("Bar", style="green")
    max_count = int(action_counts.max())
    for i in range(len(action_names)):
        count = int(action_counts[i]) if i < len(action_counts) else 0
        pct = count / total * 100
        bar_len = int(24 * count / max(max_count, 1))
        style = "dim" if pct < 1.0 else ""
        table.add_row(action_names[i], str(count), f"{pct:.1f}", "█" * bar_len, style=style)
    console.print(table)


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
    table.add_column("Coins", justify="right", style="yellow")
    table.add_column("Items", justify="right", style="yellow")
    table.add_column("Ults", justify="right", style="yellow")
    table.add_column("Drifts", justify="right", style="yellow")
    table.add_column("Ref R", justify="right", style="magenta")
    table.add_column("Ref F", justify="right", style="magenta")
    for track, metrics in report.get("tracks", {}).items():
        solo = metrics.get("solo", {})
        classic = metrics.get("classic", {})
        ref = reference.get(track, {})
        c = classic if classic.get("avg_coins") is not None else solo
        table.add_row(
            track,
            format_float(solo.get("finish_rate"), 2),
            format_float(solo.get("avg_reward"), 1),
            format_float(classic.get("finish_rate"), 2),
            format_float(classic.get("avg_reward"), 1),
            format_float(classic.get("avg_laps"), 2),
            format_float(classic.get("player_win_rate"), 2),
            ", ".join(f"{k}:{v}" for k, v in (classic.get("winner_chars") or {}).items()) or "-",
            format_float(c.get("avg_coins"), 1),
            format_float(c.get("avg_item_uses"), 1),
            format_float(c.get("avg_ult_uses"), 1),
            format_float(c.get("avg_drift_boosts"), 1),
            format_float(ref.get("avg_reward"), 1),
            format_float(ref.get("finish_rate"), 2),
        )
    console.print(table)


def print_battle_report(console: Console, title: str, report: dict[str, Any]) -> None:
    """Arena/Battle evaluation table: win rates, survival time, steals, and lives left."""
    table = Table(title=title)
    table.add_column("Arena", style="cyan")
    table.add_column("Win", justify="right", style="bold green")
    table.add_column("Survive", justify="right", style="green")
    table.add_column("Reward", justify="right")
    table.add_column("Survival s", justify="right")
    table.add_column("Approvals", justify="right", style="yellow")
    table.add_column("Pops", justify="right", style="bold red")
    table.add_column("Items", justify="right")
    table.add_column("Ults", justify="right")
    table.add_column("Winner", justify="right")
    for track, metrics in report.get("tracks", {}).items():
        b = metrics.get("battle", {})
        table.add_row(
            track,
            format_float(b.get("player_win_rate"), 2),
            format_float(b.get("battle_win_rate"), 2),
            format_float(b.get("avg_reward"), 1),
            format_float(b.get("avg_survival_time"), 1),
            format_float(b.get("avg_approvals_left"), 2),
            format_float(b.get("avg_steals"), 1),
            format_float(b.get("avg_item_uses"), 1),
            format_float(b.get("avg_ult_uses"), 1),
            ", ".join(f"{k}:{v}" for k, v in (b.get("winner_chars") or {}).items()) or "-",
        )
    console.print(table)


def launch_chromium(playwright: Any, auto_install: bool) -> Any:
    try:
        return playwright.chromium.launch(headless=True)
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
        return playwright.chromium.launch(headless=True)


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
        "mode": payload["meta"].get("mode", "race"),
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


def load_league_models(
    manifest_path: Path, limit: int | None = None, mode: str | None = None
) -> list[dict[str, Any]]:
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
        if payload.get("type") not in ("dqn", "sac"):
            continue
        # Only self-play against same-mode opponents (arena vs race have different obs spaces
        # and objectives). Models predating the mode field are treated as race.
        if mode is not None:
            payload_mode = payload.get("meta", {}).get("mode") or entry.get("mode") or "race"
            if payload_mode != mode:
                continue
        loaded.append({"entry": entry, "payload": payload, "rank": idx})
        if limit is not None and len(loaded) >= limit:
            break
    return loaded


def sample_league_opponents(args: Any, league: list[dict[str, Any]]) -> list[dict[str, Any]]:
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


def sample_battle_opponents(
    anchors: list[dict[str, Any]],
    checkpoint_pool: list[dict[str, Any]],
    *,
    total_slots: int = 4,
    classic_prob: float = 0.35,
    anchor_prob: float = 0.35,
    rng: random.Random | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Sample battle self-play opponents for one episode.

    Composition is self-play-first: most slots are the agent's own recent
    checkpoints (recency-weighted). With probability ``classic_prob`` one slot
    is the classic waypoint AI, and with probability ``anchor_prob`` one slot
    is a fixed anchor model (e.g. v5/v1). While the checkpoint pool is still
    empty (early training), remaining slots fall back to classic AI so the
    curriculum starts easy.
    """
    r = rng or random
    classic_slots = 1 if r.random() < classic_prob else 0
    opponents: list[dict[str, Any]] = []
    if anchors and r.random() < anchor_prob:
        opponents.append(r.choice(anchors)["payload"])
    while len(opponents) + classic_slots < total_slots:
        if checkpoint_pool:
            if r.random() < 0.5:
                # Recency-weighted: fight your recent self (pool is oldest-first).
                weights = [0.6 ** (len(checkpoint_pool) - 1 - i) for i in range(len(checkpoint_pool))]
                opponents.append(r.choices(checkpoint_pool, weights=weights, k=1)[0]["payload"])
            else:
                # Uniform over full history: keep beating old play styles too.
                opponents.append(r.choice(checkpoint_pool)["payload"])
        else:
            classic_slots += 1
    return opponents, classic_slots


# --- Battle opponent curriculum -----------------------------------------------

BATTLE_OPPONENT_CURRICULUM_DEFAULT = (
    "0.00:1,0.10:2,0.20:3,0.35:4,0.50:5,0.65:6,0.80:7,0.90:5|7"
)
CURRICULUM_RNG_SALT = 0xC0FFEE01


@dataclass(frozen=True)
class BattleOpponentCurriculumPhase:
    threshold: float
    choices: tuple[int, ...]


@dataclass(frozen=True)
class BattleOpponentCurriculum:
    phases: tuple[BattleOpponentCurriculumPhase, ...]

    def summary(self) -> str:
        parts = []
        for phase in self.phases:
            if len(phase.choices) == 1:
                parts.append(f"{phase.threshold:.2f}→{phase.choices[0]}")
            else:
                parts.append(f"{phase.threshold:.2f}→{'|'.join(str(c) for c in phase.choices)}")
        return ", ".join(parts)


def _parse_curriculum_choice(raw: str) -> tuple[int, ...]:
    text = raw.strip()
    if not text:
        raise ValueError("empty opponent choice")
    if "|" in text:
        parts = [p.strip() for p in text.split("|") if p.strip()]
        if len(parts) < 2:
            raise ValueError(f"expected multiple '|'-separated choices, got {raw!r}")
        choices = tuple(int(p) for p in parts)
    else:
        choices = (int(text),)
    for choice in choices:
        if not 1 <= choice <= 7:
            raise ValueError(f"opponent count out of range 1..7: {choice}")
    return choices


def parse_battle_opponent_curriculum(spec: str) -> BattleOpponentCurriculum:
    """Parse a comma-separated curriculum ``<fraction>:<choice>`` schedule."""
    text = (spec or "").strip()
    if not text:
        raise ValueError("empty battle opponent curriculum")
    phases: list[BattleOpponentCurriculumPhase] = []
    prev_threshold: float | None = None
    for part in text.split(","):
        piece = part.strip()
        if not piece or ":" not in piece:
            raise ValueError(f"malformed curriculum phase: {part!r}")
        threshold_raw, choice_raw = piece.split(":", 1)
        try:
            threshold = float(threshold_raw.strip())
        except ValueError as exc:
            raise ValueError(f"invalid curriculum threshold: {threshold_raw!r}") from exc
        if not 0.0 <= threshold < 1.0:
            raise ValueError(f"curriculum threshold must be in [0, 1): {threshold}")
        if prev_threshold is None:
            if abs(threshold) > 1e-9:
                raise ValueError("curriculum must begin at threshold 0.00")
        elif threshold <= prev_threshold:
            raise ValueError("curriculum thresholds must be strictly increasing")
        choices = _parse_curriculum_choice(choice_raw)
        phases.append(BattleOpponentCurriculumPhase(threshold=threshold, choices=choices))
        prev_threshold = threshold
    if not phases:
        raise ValueError("empty battle opponent curriculum")
    return BattleOpponentCurriculum(phases=tuple(phases))


def resolve_battle_opponent_count(
    schedule: BattleOpponentCurriculum,
    step: int,
    total_steps: int,
    rng: random.Random,
) -> int:
    """Resolve opponent count for ``step`` using the greatest threshold <= progress."""
    if total_steps <= 0:
        progress = 0.0
    else:
        progress = min(1.0, max(0.0, step / total_steps))
    active = schedule.phases[0]
    for phase in schedule.phases:
        if phase.threshold <= progress + 1e-12:
            active = phase
        else:
            break
    if len(active.choices) == 1:
        return active.choices[0]
    return int(rng.choice(active.choices))


def should_run_interval(step: int, interval: int) -> bool:
    """True when ``interval > 0`` and ``step`` is a positive multiple of ``interval``."""
    return interval > 0 and step > 0 and step % interval == 0


def validate_battle_opponents_fixed(value: int | None) -> int | None:
    if value is None:
        return None
    iv = int(value)
    if not 1 <= iv <= 7:
        raise ValueError(f"--battle-opponents must be between 1 and 7, got {iv}")
    return iv


# --- Elo rating helpers -------------------------------------------------------

def elo_expected(ra: float, rb: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))


def elo_update(ra: float, rb: float, score_a: float, k: float = 32.0) -> tuple[float, float]:
    ea = elo_expected(ra, rb)
    eb = 1.0 - ea
    return ra + k * (score_a - ea), rb + k * ((1.0 - score_a) - eb)


def load_elo_store(path: Path) -> dict:
    """Load persistent Elo ratings.

    Schema::

        {
          "ratings": {"classic": 1000.0, "dqn-arena-v5": 1050.0, "ckpt-25000": 1020.0},
          "history": [
            {"step": 25000, "name": "ckpt-25000", "rating": 1020.0,
             "records": {"classic": "2-1-0", "dqn-arena-v5": "1-2-0"}}
          ]
        }
    """
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"ratings": {"classic": 1000.0}, "history": []}


def save_elo_store(path: Path, store: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2), encoding="utf-8")


def sample_character(args: Any) -> str:
    if not args.random_character:
        return args.character
    return random.choice(parse_csv(args.characters))


def sample_map(args: Any) -> str:
    if not args.random_map:
        return args.map
    return random.choice(parse_csv(args.maps))


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


def waypoint_references(browser: Any, index_path: Path, args: Any) -> dict[str, dict[str, float]]:
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
