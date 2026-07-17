# /// script
# dependencies = [
#   "matplotlib>=3.8",
# ]
# ///
"""Plot classic-baseline eval progression from train_dqn.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="JSON file with classic_baseline progression list")
    parser.add_argument("--out", default="classic-baseline.png")
    parser.add_argument("--title", default=None)
    args = parser.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    progression = data.get("progression", [])
    if len(progression) < 2:
        raise SystemExit(f"Need at least 2 classic-baseline points in {args.data}")

    steps = [p["step"] for p in progression]
    win_rates = [p["win_rate"] for p in progression]
    avg_places = [p["avg_place"] for p in progression]

    fig, ax1 = plt.subplots(figsize=(9, 5))
    ax1.plot(steps, win_rates, marker="o", linewidth=2, color="#2fbf9f", label="win rate (1st)")
    ax1.set_xlabel("training step")
    ax1.set_ylabel("win rate", color="#2fbf9f")
    ax1.tick_params(axis="y", labelcolor="#2fbf9f")
    ax1.set_ylim(0, 1)
    ax1.grid(alpha=0.25)

    ax2 = ax1.twinx()
    ax2.plot(steps, avg_places, marker="s", linewidth=1.5, color="#7b75ff", label="avg place", alpha=0.85)
    ax2.set_ylabel("avg place (lower is better)", color="#7b75ff")
    ax2.tick_params(axis="y", labelcolor="#7b75ff")

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="best", fontsize=9)

    ax1.set_title(args.title or "Classic baseline eval progression")
    fig.tight_layout()
    fig.savefig(args.out, dpi=140)
    print(f"Wrote {args.out} ({len(steps)} points, latest win_rate {win_rates[-1]:.2f})")


if __name__ == "__main__":
    main()
