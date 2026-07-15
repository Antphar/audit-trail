"""Unit tests for battle opponent curriculum parsing and sampling."""

from __future__ import annotations

import random
import unittest
from collections import Counter

from rl_common import (
    BATTLE_OPPONENT_CURRICULUM_DEFAULT,
    BattleOpponentCurriculum,
    parse_battle_opponent_curriculum,
    resolve_battle_opponent_count,
    sample_battle_opponents,
    validate_battle_opponents_fixed,
)


class ParseCurriculumTests(unittest.TestCase):
    def test_default_schedule(self) -> None:
        schedule = parse_battle_opponent_curriculum(BATTLE_OPPONENT_CURRICULUM_DEFAULT)
        self.assertIsInstance(schedule, BattleOpponentCurriculum)
        self.assertEqual(len(schedule.phases), 8)
        self.assertEqual(schedule.phases[0].choices, (1,))
        self.assertEqual(schedule.phases[-1].choices, (5, 7))

    def test_malformed_specs(self) -> None:
        bad_specs = [
            "",
            "abc",
            "0.10:8",
            "0.10:0",
            "0.10:",
            "0.10:5|8",
            "0.10:5|",
            "0.10:2,0.05:3",
            "0.20:2",
            "1.00:1",
            "-0.1:1",
        ]
        for spec in bad_specs:
            with self.subTest(spec=spec):
                with self.assertRaises(ValueError):
                    parse_battle_opponent_curriculum(spec)


class ResolveCurriculumTests(unittest.TestCase):
    def setUp(self) -> None:
        self.schedule = parse_battle_opponent_curriculum(BATTLE_OPPONENT_CURRICULUM_DEFAULT)
        self.total = 1000

    def test_phase_boundaries(self) -> None:
        cases = [
            (0, 1),
            (99, 1),
            (100, 2),
            (199, 2),
            (200, 3),
            (349, 3),
            (350, 4),
            (499, 4),
            (500, 5),
            (649, 5),
            (650, 6),
            (799, 6),
            (800, 7),
            (899, 7),
        ]
        rng = random.Random(0)
        for step, expected in cases:
            with self.subTest(step=step):
                self.assertEqual(
                    resolve_battle_opponent_count(self.schedule, step, self.total, rng),
                    expected,
                )

    def test_final_phase_only_five_or_seven(self) -> None:
        rng = random.Random(123)
        seen: set[int] = set()
        for step in range(900, 1000):
            count = resolve_battle_opponent_count(self.schedule, step, self.total, rng)
            self.assertIn(count, {5, 7})
            seen.add(count)
        self.assertEqual(seen, {5, 7})

    def test_deterministic_with_same_seed(self) -> None:
        steps = list(range(900, 1000))
        a = [resolve_battle_opponent_count(self.schedule, s, self.total, random.Random(99)) for s in steps]
        b = [resolve_battle_opponent_count(self.schedule, s, self.total, random.Random(99)) for s in steps]
        self.assertEqual(a, b)

    def test_independent_rng_per_step(self) -> None:
        rng = random.Random(42)
        counts = Counter(
            resolve_battle_opponent_count(self.schedule, step, self.total, rng)
            for step in range(900, 1000)
        )
        self.assertTrue(counts[5] > 0 and counts[7] > 0)


class FixedOverrideTests(unittest.TestCase):
    def test_validate_none(self) -> None:
        self.assertIsNone(validate_battle_opponents_fixed(None))

    def test_validate_in_range(self) -> None:
        self.assertEqual(validate_battle_opponents_fixed(3), 3)

    def test_validate_out_of_range(self) -> None:
        with self.assertRaises(ValueError):
            validate_battle_opponents_fixed(0)
        with self.assertRaises(ValueError):
            validate_battle_opponents_fixed(8)


class SampleBattleOpponentsTests(unittest.TestCase):
    def test_total_slots_one_empty_pool(self) -> None:
        opponents, classic = sample_battle_opponents([], [], total_slots=1, rng=random.Random(1))
        self.assertEqual(len(opponents) + classic, 1)

    def test_total_slots_seven_nonempty_pool(self) -> None:
        pool = [{"name": f"ckpt-{i}", "payload": {"type": "dqn", "meta": {"step": i}}} for i in range(5)]
        opponents, classic = sample_battle_opponents([], pool, total_slots=7, rng=random.Random(2))
        self.assertEqual(len(opponents) + classic, 7)

    def test_total_slots_seven_empty_pool(self) -> None:
        opponents, classic = sample_battle_opponents([], [], total_slots=7, rng=random.Random(3))
        self.assertEqual(len(opponents) + classic, 7)
        self.assertEqual(classic, 7)


if __name__ == "__main__":
    unittest.main()
