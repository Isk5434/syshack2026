"""
RL training manager.

Runs PPO training in a background thread and exposes progress via
``get_training_state()``.  API layer (main.py) polls this to push
updates to the frontend.
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback

from rl_env import CafeteriaEnv

RESULTS_DIR = Path(__file__).parent / "rl_results"
RESULTS_DIR.mkdir(exist_ok=True)


# ── Shared mutable training state ─────────────────────────────────────────

@dataclass
class TrainingState:
    is_training:      bool  = False
    progress:         float = 0.0          # 0-1
    total_timesteps:  int   = 0
    current_timestep: int   = 0
    best_reward:      float = -float("inf")
    best_layout:      Optional[List[List[str]]] = None
    episode_rewards:  List[float] = field(default_factory=list)
    status:           str = "idle"         # idle | training | completed | error:…
    started_at:       float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        elapsed = time.time() - self.started_at if self.started_at else 0
        return {
            "is_training":      self.is_training,
            "progress":         round(self.progress * 100, 1),
            "total_timesteps":  self.total_timesteps,
            "current_timestep": self.current_timestep,
            "best_reward":      round(self.best_reward, 2) if self.best_reward > -1e9 else None,
            "best_layout":      self.best_layout,
            "recent_rewards":   self.episode_rewards[-30:],
            "status":           self.status,
            "elapsed_sec":      round(elapsed, 1),
        }


training_state = TrainingState()


# ── Callback for SB3 ──────────────────────────────────────────────────────

class _ProgressCallback(BaseCallback):
    """Pumps metrics from SB3 into the shared ``TrainingState``."""

    def __init__(self, state: TrainingState, verbose: int = 0) -> None:
        super().__init__(verbose)
        self._state = state

    def _on_step(self) -> bool:
        self._state.current_timestep = self.num_timesteps
        self._state.progress = self.num_timesteps / max(1, self._state.total_timesteps)

        # Episode-level reward tracking
        infos = self.locals.get("infos", [])
        for info in infos:
            ep = info.get("episode")
            if ep is not None:
                self._state.episode_rewards.append(round(float(ep["r"]), 2))

        # Best layout tracking (from env)
        try:
            env = self.training_env.envs[0].unwrapped
            if hasattr(env, "best_cells") and env.best_cells is not None:
                if env.best_reward > self._state.best_reward:
                    self._state.best_reward = env.best_reward
                    self._state.best_layout = [row[:] for row in env.best_cells]
        except Exception:
            pass

        # Allow external stop
        return self._state.is_training


# ── Training entry points ─────────────────────────────────────────────────

def _run_training(
    total_timesteps: int,
    sim_steps: int,
    max_swaps: int,
    config: Optional[Dict[str, Any]],
) -> None:
    global training_state
    try:
        env = CafeteriaEnv(
            sim_steps=sim_steps,
            max_swaps=max_swaps,
            config=config,
        )

        model = PPO(
            "MlpPolicy",
            env,
            verbose=0,
            learning_rate=3e-4,
            n_steps=max(max_swaps * 2, 64),
            batch_size=max(max_swaps, 32),
            n_epochs=4,
            gamma=0.99,
            ent_coef=0.01,
            device="cpu",
        )

        cb = _ProgressCallback(training_state)
        model.learn(total_timesteps=total_timesteps, callback=cb)

        # Persist best result
        if training_state.best_layout:
            path = RESULTS_DIR / "best_layout.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "cells": training_state.best_layout,
                        "reward": training_state.best_reward,
                        "episode_rewards": training_state.episode_rewards,
                    },
                    f,
                )

        training_state.status = "completed"

    except Exception as exc:
        training_state.status = f"error: {exc}"
    finally:
        training_state.is_training = False


def start_training(
    total_timesteps: int = 5_000,
    sim_steps: int = 100,
    max_swaps: int = 20,
    config: Optional[Dict[str, Any]] = None,
) -> bool:
    """Launch training in a daemon thread. Returns False if already running."""
    global training_state
    if training_state.is_training:
        return False

    training_state = TrainingState(
        is_training=True,
        total_timesteps=total_timesteps,
        status="training",
        started_at=time.time(),
    )

    t = threading.Thread(
        target=_run_training,
        args=(total_timesteps, sim_steps, max_swaps, config),
        daemon=True,
    )
    t.start()
    return True


def stop_training() -> None:
    training_state.is_training = False
    training_state.status = "stopped"


def get_training_state() -> Dict[str, Any]:
    return training_state.to_dict()
