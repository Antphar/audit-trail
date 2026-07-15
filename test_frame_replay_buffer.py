"""Unit tests for FrameReplayBuffer n-step returns and sum-tree PER."""

from __future__ import annotations

import unittest
from collections import Counter
from unittest.mock import patch

import numpy as np
import torch

from rl_common import FrameReplayBuffer, _SumTree


def _make_buffer(
    capacity: int = 32,
    *,
    n_step: int = 1,
    gamma: float = 0.99,
    alpha: float | None = None,
    frame_stack: int = 1,
    base_dim: int = 1,
) -> FrameReplayBuffer:
    return FrameReplayBuffer(
        capacity=capacity,
        base_dim=base_dim,
        frame_stack=frame_stack,
        stack_mask=None,
        dtype="float16",
        alpha=alpha,
        n_step=n_step,
        gamma=gamma,
    )


def _frame(value: float, dim: int = 1) -> np.ndarray:
    return np.full(dim, value, dtype=np.float32)


def _fill_episode(
    buf: FrameReplayBuffer,
    rewards: list[float],
    *,
    terminal: bool = True,
    start_value: float = 0.0,
    step_value: float = 0.1,
) -> None:
    buf.start_episode(_frame(start_value))
    value = start_value + step_value
    for i, reward in enumerate(rewards):
        done = terminal and i == len(rewards) - 1
        buf.add(_frame(value), action=i % 5, reward=reward, done=done)
        value += step_value


class SumTreeTests(unittest.TestCase):
    def test_non_power_of_two_capacity(self) -> None:
        tree = _SumTree(100_000)
        tree.set(0, 3.0)
        tree.set(99_999, 7.0)
        tree.set(50_000, 5.0)
        self.assertAlmostEqual(tree.total(), 15.0)
        self.assertAlmostEqual(tree.get(0), 3.0)
        self.assertAlmostEqual(tree.get(50_000), 5.0)
        self.assertAlmostEqual(tree.get(99_999), 7.0)
        self.assertAlmostEqual(tree.get(42_000), 0.0)

    def test_zero_leaves_never_sampled(self) -> None:
        tree = _SumTree(16)
        tree.set(3, 4.0)
        tree.set(7, 6.0)
        for _ in range(200):
            idx = tree.stratified_sample(1)[0]
            self.assertIn(idx, (3, 7))

    def test_zero_prefix_skips_zero_and_padded_leaves(self) -> None:
        tree = _SumTree(5)
        tree.set(4, 2.0)
        self.assertEqual(tree._retrieve(0.0), 4)
        with patch("rl_common.random.random", return_value=0.0):
            indices = tree.stratified_sample(8)
        np.testing.assert_array_equal(indices, np.full(8, 4))

    def test_prefix_sample_boundaries(self) -> None:
        tree = _SumTree(8)
        for i in range(8):
            tree.set(i, float(i + 1))
        total = tree.total()
        segment = total / 4
        boundaries = [segment * i for i in range(5)]
        for seg in range(4):
            low = boundaries[seg]
            high = boundaries[seg + 1] if seg < 3 else total
            cum = (low + high) / 2.0
            idx = tree._retrieve(cum)
            leaf = tree.get(idx)
            self.assertGreater(leaf, 0.0)

    def test_distribution_shifts_after_priority_change(self) -> None:
        tree = _SumTree(4)
        tree.set(0, 1.0)
        tree.set(1, 1.0)
        tree.set(2, 1.0)
        tree.set(3, 1.0)
        before = Counter(tree.stratified_sample(400).tolist())
        tree.set(0, 100.0)
        after = Counter(tree.stratified_sample(400).tolist())
        self.assertGreater(after[0], before[0] * 3)


class NStepReplayTests(unittest.TestCase):
    def test_n1_equivalence_to_one_step(self) -> None:
        buf = _make_buffer(capacity=16, n_step=1, gamma=0.99)
        _fill_episode(buf, [1.0, -0.5, 2.0, 0.25], terminal=False)
        buf.add(_frame(9.9), action=9, reward=3.0, done=True)

        indices = np.flatnonzero(buf.sampleable)
        self.assertGreaterEqual(indices.shape[0], 4)
        rewards, dones, next_anchors = buf._batch_chain_info(indices)
        for anchor, reward, done, next_anchor in zip(indices, rewards, dones, next_anchors):
            self.assertAlmostEqual(reward, float(buf.rewards[anchor]), places=3)
            self.assertEqual(bool(done), bool(buf.dones[anchor]))
            self.assertEqual(int(next_anchor), (int(anchor) + 1) % buf._capacity)

        batch = buf.sample(4)
        obs, actions, batch_rewards, next_obs, batch_dones = batch[:5]
        self.assertEqual(obs.shape[0], 4)
        self.assertTrue(torch.isfinite(obs).all())
        self.assertTrue(torch.isfinite(next_obs).all())
        self.assertEqual(actions.shape, (4, 1))

    def test_n3_known_return_and_next_anchor(self) -> None:
        buf = _make_buffer(capacity=16, n_step=3, gamma=0.9)
        _fill_episode(buf, [1.0, 2.0, 3.0, 4.0], terminal=False)
        buf.add(_frame(5.0), action=0, reward=5.0, done=False)

        ok, total, done, next_anchor = buf._evaluate_anchor(0)
        self.assertTrue(ok)
        self.assertFalse(done)
        self.assertAlmostEqual(total, 1.0 + 0.9 * 2.0 + 0.81 * 3.0)
        self.assertEqual(next_anchor, 3)

        obs, _, rewards, next_obs, dones = buf.sample(2)
        self.assertTrue(np.isfinite(obs.numpy()).all())
        for reward in rewards.numpy():
            self.assertTrue(
                any(
                    np.isclose(reward, buf._evaluate_anchor(int(a))[1])
                    for a in np.flatnonzero(buf.sampleable)
                )
            )

    def test_terminal_at_step_two_truncates_chain(self) -> None:
        buf = _make_buffer(capacity=16, n_step=3, gamma=0.9)
        buf.start_episode(_frame(0.0))
        buf.add(_frame(1.0), action=1, reward=1.0, done=False)
        buf.add(_frame(2.0), action=2, reward=2.0, done=True)

        ok, total, done, next_anchor = buf._evaluate_anchor(0)
        self.assertTrue(ok)
        self.assertTrue(done)
        self.assertAlmostEqual(total, 1.0 + 0.9 * 2.0)
        self.assertEqual(next_anchor, 2)

        obs, _, reward, next_obs, done_t = buf.sample(1)
        sampled = float(reward[0])
        for anchor in np.flatnonzero(buf.sampleable):
            ok_a, exp, exp_done, next_a = buf._evaluate_anchor(int(anchor))
            self.assertTrue(ok_a)
            if np.isclose(sampled, exp, rtol=1e-4, atol=1e-4):
                self.assertAlmostEqual(float(done_t[0]), float(exp_done))
                if exp_done:
                    self.assertAlmostEqual(float(next_obs[0, 0]), float(buf.frames[next_a, 0]), places=3)
                return
        self.fail(f"sampled reward {sampled} not in expected sampleable returns")

    def test_incomplete_nonterminal_anchors_mature_later(self) -> None:
        buf = _make_buffer(capacity=16, n_step=3, gamma=0.9)
        buf.start_episode(_frame(0.0))
        buf.add(_frame(1.0), action=0, reward=1.0, done=False)
        buf.add(_frame(2.0), action=1, reward=2.0, done=False)
        self.assertFalse(buf.sampleable[0])
        self.assertEqual(len(buf), 0)

        buf.add(_frame(3.0), action=2, reward=3.0, done=False)
        self.assertTrue(buf.sampleable[0])
        self.assertEqual(len(buf), 1)

    def test_episode_boundary_no_crossing(self) -> None:
        buf = _make_buffer(capacity=16, n_step=3, gamma=0.9)
        _fill_episode(buf, [1.0, 2.0], terminal=True)
        buf.start_episode(_frame(10.0))
        buf.add(_frame(11.0), action=0, reward=7.0, done=False)

        self.assertTrue(buf.sampleable[0])
        ok, total, done, _ = buf._evaluate_anchor(0)
        self.assertTrue(ok)
        self.assertTrue(done)
        self.assertAlmostEqual(total, 1.0 + 0.9 * 2.0)

        self.assertFalse(buf.sampleable[2])

    def test_terminal_preceding_reset_matures(self) -> None:
        buf = _make_buffer(capacity=16, n_step=3, gamma=0.9)
        buf.start_episode(_frame(0.0))
        buf.add(_frame(1.0), action=0, reward=4.0, done=True)
        self.assertTrue(buf.sampleable[0])
        buf.start_episode(_frame(100.0))
        self.assertTrue(buf.sampleable[0])
        self.assertEqual(len(buf), 1)

    def test_ring_wraparound_preserves_episode_integrity(self) -> None:
        buf = _make_buffer(capacity=6, n_step=2, gamma=0.5)
        for ep in range(8):
            start = float(ep * 10)
            buf.start_episode(_frame(start))
            buf.add(_frame(start + 1), action=ep, reward=1.0, done=False)
            buf.add(_frame(start + 2), action=ep, reward=2.0, done=True)

        self.assertGreaterEqual(len(buf), 1)
        self.assertLessEqual(len(buf), buf._capacity - buf._n_step + 1)

        for _ in range(20):
            batch_size = min(2, len(buf))
            obs, _, _, _, _ = buf.sample(batch_size)
            self.assertTrue(np.isfinite(obs.numpy()).all())

        for anchor in np.flatnonzero(buf.sampleable):
            ep = int(buf.episodes[anchor])
            step = 0
            slot = int(anchor)
            while step < buf._n_step:
                self.assertTrue(buf.valid[slot])
                self.assertEqual(int(buf.episodes[slot]), ep)
                if buf.dones[slot]:
                    break
                step += 1
                slot = (slot + 1) % buf._capacity

    def test_single_episode_wrap_uses_chronological_frame_ids(self) -> None:
        buf = FrameReplayBuffer(
            capacity=8,
            base_dim=1,
            frame_stack=4,
            stack_mask=None,
            dtype="float32",
            n_step=3,
            gamma=0.9,
        )
        buf.start_episode(_frame(0.0))
        for value in range(1, 31):
            buf.add(
                _frame(float(value)),
                action=0,
                reward=float(value),
                done=False,
            )

        sampleable = np.flatnonzero(buf.sampleable)
        sampleable_ids = sorted(int(buf.frame_ids[slot]) for slot in sampleable)
        self.assertEqual(sampleable_ids, [23, 24, 25, 26, 27])

        for slot in sampleable:
            frame_id = int(buf.frame_ids[slot])
            obs, next_obs = buf._reconstruct_stacks(
                np.array([slot]),
                np.array([(slot + buf._n_step) % buf._capacity]),
            )
            earliest_id = 23
            expected_obs = [
                float(max(frame_id - lag, earliest_id))
                for lag in range(buf._frame_stack)
            ]
            expected_next = [
                float(frame_id + buf._n_step - lag)
                for lag in range(buf._frame_stack)
            ]
            np.testing.assert_array_equal(obs[0], expected_obs)
            np.testing.assert_array_equal(next_obs[0], expected_next)

            ok, reward, done, next_anchor = buf._evaluate_anchor(int(slot))
            self.assertTrue(ok)
            self.assertFalse(done)
            expected_reward = (
                (frame_id + 1)
                + 0.9 * (frame_id + 2)
                + 0.81 * (frame_id + 3)
            )
            self.assertAlmostEqual(reward, expected_reward)
            self.assertEqual(int(buf.frame_ids[next_anchor]), frame_id + 3)
            self.assertEqual(float(buf.frames[next_anchor, 0]), float(frame_id + 3))

        slot_24 = int(np.flatnonzero(buf.frame_ids == 24)[0])
        slot_23 = int(np.flatnonzero(buf.frame_ids == 23)[0])
        obs, _ = buf._reconstruct_stacks(np.array([slot_24]))
        np.testing.assert_array_equal(obs[0], [24.0, 23.0, 23.0, 23.0])
        obs, _ = buf._reconstruct_stacks(np.array([slot_23]))
        np.testing.assert_array_equal(obs[0], [23.0, 23.0, 23.0, 23.0])

    def test_per_indices_are_ring_slots(self) -> None:
        buf = _make_buffer(capacity=12, n_step=1, alpha=0.6)
        _fill_episode(buf, [1.0, 2.0, 3.0, 4.0])
        batch = buf.sample(4, beta=0.4)
        indices = batch[6]
        self.assertEqual(indices.shape, (4,))
        self.assertTrue(np.all(indices >= 0))
        self.assertTrue(np.all(indices < buf._capacity))
        for idx in np.asarray(indices).tolist():
            self.assertTrue(buf.sampleable[int(idx)])

    def test_per_priority_updates_skew_sampling(self) -> None:
        buf = _make_buffer(capacity=8, n_step=1, alpha=0.6)
        _fill_episode(buf, [1.0, 1.0, 1.0, 1.0, 1.0])
        sampleable = np.flatnonzero(buf.sampleable)
        target = int(sampleable[0])
        buf.update_priorities(np.array([target]), np.array([50.0]))
        counts = Counter()
        for _ in range(300):
            idx = int(buf.sample(1, beta=0.0)[6][0])
            counts[idx] += 1
        self.assertGreater(counts[target], 150)

    def test_n1_per_smoke_shapes_finite(self) -> None:
        buf = _make_buffer(capacity=20, n_step=1, alpha=0.6)
        _fill_episode(buf, [0.5, -0.25, 1.5, 0.0, 2.0])
        batch = buf.sample(5, beta=0.4)
        obs, actions, rewards, next_obs, dones, weights, indices = batch
        self.assertEqual(obs.shape[0], 5)
        self.assertTrue(torch.isfinite(obs).all())
        self.assertTrue(torch.isfinite(next_obs).all())
        self.assertTrue(torch.isfinite(rewards).all())
        self.assertTrue(torch.isfinite(dones).all())
        self.assertTrue(torch.isfinite(weights).all())
        self.assertEqual(indices.shape, (5,))


if __name__ == "__main__":
    unittest.main()
