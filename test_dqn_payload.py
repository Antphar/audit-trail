"""Unit tests for build_dqn_payload schema and weight serialization."""

from __future__ import annotations

import base64
import json
import unittest

import numpy as np
import torch

from rl_common import RolloutEntry
from train_dqn import (
    DQN,
    build_compact_dqn_policy,
    build_dqn_payload,
    export_dqn_json,
    record_replay_transition,
)


class BuildDqnPayloadTests(unittest.TestCase):
    def _model(self, *, layer_norm: bool = False, mean_expansion_k: float = 0.0, rdq: bool = False) -> DQN:
        return DQN(
            obs_dim=8,
            action_dim=4,
            hidden=16,
            activation="gelu",
            layer_norm=layer_norm,
            mean_expansion_k=mean_expansion_k,
            advantage_centering=not rdq,
        )

    def test_payload_schema(self) -> None:
        model = self._model(layer_norm=True, mean_expansion_k=0.5)
        obs_keys = [f"feat{i}" for i in range(8)]
        actions = [{"name": f"a{i}", "steer": 0.0, "throttle": 1.0} for i in range(4)]
        meta = {"frameStack": 2, "frameSkip": 4, "mode": "battle"}
        payload = build_dqn_payload(model, obs_keys, actions, meta=meta)

        self.assertEqual(payload["type"], "dqn")
        self.assertEqual(payload["format"], "turbo-kart-headless-dqn-v2")
        self.assertEqual(payload["architecture"], "dueling")
        self.assertEqual(payload["observationKeys"], obs_keys)
        self.assertEqual(payload["actions"], actions)
        self.assertEqual(payload["meta"], meta)
        self.assertTrue(payload["advantageCentering"])
        self.assertAlmostEqual(payload["meanExpansionK"], 0.5)
        self.assertEqual(len(payload["trunk"]), 2)
        self.assertIn("layernorm", payload["trunk"][0])
        self.assertEqual(payload["trunk"][0]["activation"], "gelu")
        self.assertIn("weights", payload["value_head"])
        self.assertIn("biases", payload["advantage_head"])

    def test_weight_shapes_match_model(self) -> None:
        model = self._model()
        obs_keys = [f"obs{i}" for i in range(8)]
        actions = [{"name": "noop", "steer": 0.0, "throttle": 1.0}]
        payload = build_dqn_payload(model, obs_keys, actions)

        trunk0 = payload["trunk"][0]
        w = trunk0["weights"]
        b = trunk0["biases"]
        self.assertEqual(len(w), 8 * 16)
        self.assertEqual(len(b), 16)
        self.assertEqual(len(payload["advantage_head"]["weights"]), 16 * 4)
        self.assertEqual(len(payload["advantage_head"]["biases"]), 4)

    def test_export_roundtrip_matches_build(self) -> None:
        import tempfile
        from pathlib import Path

        model = self._model(rdq=True)
        obs_keys = ["speed", "progress"]
        actions = [{"name": "go", "steer": 0.0, "throttle": 1.0}]
        meta = {"id": "test", "step": 1}
        built = build_dqn_payload(model, obs_keys, actions, meta=meta)

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "model.json"
            export_dqn_json(model, obs_keys, actions, out, meta, manifest_path=None)
            exported = json.loads(out.read_text(encoding="utf-8"))

        self.assertEqual(exported["type"], built["type"])
        self.assertEqual(exported["observationKeys"], built["observationKeys"])
        self.assertEqual(exported["trunk"][0]["weights"], built["trunk"][0]["weights"])
        self.assertEqual(exported["value_head"]["biases"], built["value_head"]["biases"])
        self.assertFalse(exported["advantageCentering"])


class CompactDqnPayloadTests(unittest.TestCase):
    @staticmethod
    def _view(flat: np.ndarray, descriptor: dict) -> np.ndarray:
        start = descriptor["offset"]
        end = start + descriptor["length"]
        return flat[start:end]

    def test_compact_parameters_match_standard_payload(self) -> None:
        model = DQN(
            obs_dim=12,
            action_dim=5,
            hidden=32,
            activation="relu",
            layer_norm=True,
            mean_expansion_k=0.25,
            advantage_centering=False,
        )
        obs_keys = [f"obs{i}" for i in range(12)]
        actions = [{"name": f"a{i}"} for i in range(5)]
        standard = build_dqn_payload(model, obs_keys, actions, meta={"mode": "battle"})
        compact = build_compact_dqn_policy(model, obs_keys, actions, meta={"mode": "battle"})
        flat = np.frombuffer(base64.b64decode(compact["weightsBase64"]), dtype="<f4")

        self.assertEqual(compact["format"], "turbo-kart-headless-dqn-compact-v1")
        self.assertEqual(compact["encoding"], "base64-f32le")
        self.assertEqual(flat.size, compact["floatCount"])
        self.assertEqual(compact["observationKeys"], standard["observationKeys"])
        self.assertEqual(compact["actions"], standard["actions"])
        self.assertEqual(compact["advantageCentering"], standard["advantageCentering"])
        self.assertEqual(compact["meanExpansionK"], standard["meanExpansionK"])

        for compact_layer, standard_layer in zip(
            compact["trunk"],
            standard["trunk"],
            strict=True,
        ):
            np.testing.assert_allclose(
                self._view(flat, compact_layer["weights"]),
                standard_layer["weights"],
            )
            np.testing.assert_allclose(
                self._view(flat, compact_layer["biases"]),
                standard_layer["biases"],
            )
            self.assertEqual(compact_layer["activation"], standard_layer["activation"])
            np.testing.assert_allclose(
                self._view(flat, compact_layer["layernorm"]["weight"]),
                standard_layer["layernorm"]["weight"],
            )
            np.testing.assert_allclose(
                self._view(flat, compact_layer["layernorm"]["bias"]),
                standard_layer["layernorm"]["bias"],
            )
            self.assertEqual(
                compact_layer["layernorm"]["eps"],
                standard_layer["layernorm"]["eps"],
            )

        for head in ("value_head", "advantage_head"):
            np.testing.assert_allclose(
                self._view(flat, compact[head]["weights"]),
                standard[head]["weights"],
            )
            np.testing.assert_allclose(
                self._view(flat, compact[head]["biases"]),
                standard[head]["biases"],
            )

    def test_compact_json_is_under_35_percent_of_standard(self) -> None:
        model = DQN(obs_dim=260, action_dim=15, hidden=128, activation="tanh")
        obs_keys = [f"obs{i}" for i in range(260)]
        actions = [{"name": f"a{i}"} for i in range(15)]
        standard = build_dqn_payload(model, obs_keys, actions)
        compact = build_compact_dqn_policy(model, obs_keys, actions)
        standard_size = len(json.dumps(standard, separators=(",", ":")))
        compact_size = len(json.dumps(compact, separators=(",", ":")))
        self.assertLess(compact_size, standard_size * 0.35)


class ReplayFrameOrderRegressionTests(unittest.TestCase):
    def test_multi_entry_rollout_records_each_base_frame_in_order(self) -> None:
        class SpyBuffer:
            def __init__(self) -> None:
                self.frames: list[np.ndarray] = []

            def add(self, base_obs, action, reward, done) -> None:
                self.frames.append(np.asarray(base_obs).copy())

        entries = [
            RolloutEntry(
                base_obs=np.full(3, value, dtype=np.float32),
                stacked_obs=np.full(6, value, dtype=np.float32),
                action=i,
                reward=float(i),
                done=False,
                info={},
                q_max=None,
                q_mean=None,
            )
            for i, value in enumerate((1.0, 2.0, 3.0))
        ]
        buffer = SpyBuffer()

        for entry in entries:
            record_replay_transition(
                buffer,
                entry.base_obs,
                entry.action,
                entry.reward,
                entry.done,
            )

        self.assertEqual(len(buffer.frames), 3)
        for written, entry in zip(buffer.frames, entries, strict=True):
            np.testing.assert_array_equal(written, entry.base_obs)


if __name__ == "__main__":
    unittest.main()
