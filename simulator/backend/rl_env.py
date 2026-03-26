"""
Gymnasium environment wrapping the cafeteria simulation.

Observation : flattened grid (int-encoded) + 6 normalised stats
Action      : index pair into interior cells → swap two tiles
Reward      : revenue + throughput - wait - abandonment + seat utilisation

Object counts are preserved because only *swaps* are allowed.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from grid_layout import GRID_H, GRID_W, GridLayout, NodeType
from model import CafeteriaModel

# ── Encoding ──────────────────────────────────────────────────────────────

NODE_TYPE_TO_INT: Dict[str, int] = {
    "wall": 0, "floor": 1, "entry": 2, "ticket": 3,
    "counter": 4, "seat": 5, "return": 6,
}
INT_TO_NODE_TYPE: Dict[int, str] = {v: k for k, v in NODE_TYPE_TO_INT.items()}

# ── Environment ───────────────────────────────────────────────────────────


class CafeteriaEnv(gym.Env):
    """
    RL environment for optimising cafeteria *layout*.

    Each episode:
      1. Start from the default layout.
      2. Agent performs up to ``max_swaps`` tile swaps.
      3. After each swap the simulation is fast-forwarded ``sim_steps`` ticks
         and a reward is computed from the resulting KPIs.
    """

    metadata: dict = {"render_modes": []}

    def __init__(
        self,
        sim_steps: int = 100,
        max_swaps: int = 20,
        config: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__()
        self.sim_steps = sim_steps
        self.max_swaps = max_swaps
        self.config: Dict[str, Any] = config or {
            "spawn_rate": 0.8,
            "n_staff": 3,
            "n_ticket_machines": 3,
            "staff_service_time": 10,
        }

        # Interior cells (everything except the outer border wall)
        self.interior_coords: List[Tuple[int, int]] = [
            (x, y)
            for y in range(1, GRID_H - 1)
            for x in range(1, GRID_W - 1)
        ]
        n_interior = len(self.interior_coords)

        # Action = (cell_a, cell_b) indices → swap
        self.action_space = spaces.MultiDiscrete([n_interior, n_interior])

        # Observation = flattened grid + 6 KPI floats
        obs_size = GRID_H * GRID_W + 6
        self.observation_space = spaces.Box(
            low=0.0, high=1000.0, shape=(obs_size,), dtype=np.float32,
        )

        # Episode state
        self.cells: List[List[str]] = []
        self.swap_count: int = 0
        self.last_stats: Dict[str, Any] = {}
        self.best_reward: float = -float("inf")
        self.best_cells: Optional[List[List[str]]] = None
        self._cumulative_reward: float = 0.0

    # ── Gym interface ─────────────────────────────────────────────────

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[dict] = None,
    ) -> Tuple[np.ndarray, dict]:
        super().reset(seed=seed)

        # Build default layout and extract cells as plain strings
        layout = GridLayout(
            self.config["n_ticket_machines"],
            self.config["n_staff"],
        )
        self.cells = [[cell.value for cell in row] for row in layout._grid]
        self.swap_count = 0
        self._cumulative_reward = 0.0

        # Baseline evaluation
        self.last_stats = self._evaluate()
        return self._get_obs(), {}

    def step(self, action: np.ndarray) -> Tuple[np.ndarray, float, bool, bool, dict]:
        idx1, idx2 = int(action[0]), int(action[1])

        # Perform swap (only if the two cells are different types)
        if idx1 != idx2:
            x1, y1 = self.interior_coords[idx1]
            x2, y2 = self.interior_coords[idx2]
            c1 = self.cells[y1][x1]
            c2 = self.cells[y2][x2]
            if c1 != c2:
                self.cells[y1][x1] = c2
                self.cells[y2][x2] = c1

        self.swap_count += 1

        # Evaluate new layout
        stats = self._evaluate()
        reward = self._compute_reward(stats)
        self.last_stats = stats
        self._cumulative_reward += reward

        # Track best ever
        if self._cumulative_reward > self.best_reward:
            self.best_reward = self._cumulative_reward
            self.best_cells = [row[:] for row in self.cells]

        terminated = self.swap_count >= self.max_swaps
        return self._get_obs(), reward, terminated, False, {"stats": stats}

    # ── Internal helpers ──────────────────────────────────────────────

    def _evaluate(self) -> Dict[str, Any]:
        """Build a model from current cells, fast-forward, return stats."""
        try:
            layout = GridLayout.from_cells(self.cells)
            if not layout.entry_positions or not layout.counter_positions:
                # Invalid layout – penalise
                return self._empty_stats()
            model = CafeteriaModel(
                spawn_rate=self.config["spawn_rate"],
                n_staff=self.config["n_staff"],
                n_ticket_machines=self.config["n_ticket_machines"],
                staff_service_time=self.config["staff_service_time"],
                custom_layout=layout,
            )
            for _ in range(self.sim_steps):
                model.step()
            state = model.collect_state()
            return state["stats"]
        except Exception:
            return self._empty_stats()

    @staticmethod
    def _empty_stats() -> Dict[str, Any]:
        return {
            "total_students": 0, "total_served": 0, "total_abandoned": 0,
            "avg_wait": 100.0, "revenue": 0.0, "seat_utilisation": 0.0,
            "throughput_history": [], "rho": 0.0,
        }

    def _compute_reward(self, stats: Dict[str, Any]) -> float:
        revenue    = stats.get("revenue", 0.0)
        served     = stats.get("total_served", 0)
        avg_wait   = stats.get("avg_wait", 0.0)
        abandoned  = stats.get("total_abandoned", 0)
        seat_util  = stats.get("seat_utilisation", 0.0)

        # Weighted combination (positive = good)
        return (
            revenue * 0.01
            + served * 1.0
            - avg_wait * 0.5
            - abandoned * 2.0
            + seat_util * 5.0
        )

    def _get_obs(self) -> np.ndarray:
        grid_flat = [
            float(NODE_TYPE_TO_INT.get(c, 1))
            for row in self.cells for c in row
        ]
        s = self.last_stats
        kpi = [
            float(s.get("total_served", 0)),
            float(s.get("avg_wait", 0)),
            float(s.get("revenue", 0)) / 1000.0,   # normalise
            float(s.get("seat_utilisation", 0)),
            float(s.get("total_abandoned", 0)),
            float(s.get("rho", 0)),
        ]
        return np.array(grid_flat + kpi, dtype=np.float32)
