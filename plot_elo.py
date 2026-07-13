# /// script
# dependencies = [
#   "matplotlib>=3.8",
# ]
# ///
"""Plot the Elo progression of a training run's checkpoints.

Reads the elo store written by train_dqn.py rating rounds and renders a chart:
the agent's checkpoint Elo over training steps, with anchor opponents as
reference lines (their full trajectory when ratings snapshots are present in
the history, otherwise their final rating as a dashed line).

Run:
  uv run plot_elo.py --store models/checkpoints/elo-dqn-arena-v6.json --out elo-progress.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", default="models/checkpoints/elo-dqn-arena-v6.json")
    parser.add_argument("--out", default="elo-progress.png")
    parser.add_argument("--title", default=None)
    args = parser.parse_args()

    store = json.loads(Path(args.store).read_text(encoding="utf-8"))
    history = store.get("history", [])
    ratings = store.get("ratings", {})

    ckpt_points = [(h["step"], h["rating"]) for h in history if str(h.get("name", "")).startswith("ckpt-")]
    if not ckpt_points:
        raise SystemExit(f"No checkpoint history in {args.store}")
    steps, elos = zip(*sorted(ckpt_points))

    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(steps, elos, marker="o", linewidth=2, color="#ff7a1a", label="training checkpoints")

    anchors = [name for name in ratings if name != "classic" and not name.startswith("ckpt-")]
    # Anchor trajectories from per-round snapshots when available (newer runs),
    # otherwise fall back to a flat line at the anchor's final rating.
    palette = ["#7b75ff", "#2fbf9f", "#c05ad2", "#888888"]
    for i, name in enumerate(sorted(anchors)):
        color = palette[i % len(palette)]
        snap_points = [
            (h["step"], h["ratings_snapshot"][name])
            for h in history
            if "ratings_snapshot" in h and name in h.get("ratings_snapshot", {})
        ]
        if snap_points:
            xs, ys = zip(*sorted(snap_points))
            ax.plot(xs, ys, linewidth=1.4, alpha=0.8, color=color, label=f"anchor: {name}")
        else:
            ax.axhline(ratings[name], linestyle="--", linewidth=1.2, alpha=0.7, color=color, label=f"anchor: {name} (final)")

    ax.axhline(1000.0, linestyle=":", linewidth=1.2, color="#444444", label="classic waypoint AI (fixed 1000)")

    ax.set_xlabel("training step")
    ax.set_ylabel("Elo")
    ax.set_title(args.title or f"Arena agent Elo progression — {Path(args.store).stem}")
    ax.grid(alpha=0.25)
    ax.legend(loc="best", fontsize=9)
    fig.tight_layout()
    fig.savefig(args.out, dpi=140)
    print(f"Wrote {args.out} ({len(steps)} checkpoints, latest Elo {elos[-1]:.1f})")


if __name__ == "__main__":
    main()
