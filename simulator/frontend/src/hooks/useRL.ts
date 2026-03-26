/**
 * useRL – polls the RL training status endpoint and exposes
 * control helpers (train / stop / apply).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8001";

export interface RLStatus {
  is_training:      boolean;
  progress:         number;       // 0–100
  total_timesteps:  number;
  current_timestep: number;
  best_reward:      number | null;
  best_layout:      string[][] | null;
  recent_rewards:   number[];
  status:           string;       // idle | training | completed | stopped | error:…
  elapsed_sec:      number;
}

const EMPTY: RLStatus = {
  is_training: false, progress: 0, total_timesteps: 0,
  current_timestep: 0, best_reward: null, best_layout: null,
  recent_rewards: [], status: "idle", elapsed_sec: 0,
};

export function useRL() {
  const [rl, setRL] = useState<RLStatus>(EMPTY);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll while training
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/rl/status`);
        if (r.ok) setRL(await r.json());
      } catch { /* backend down */ }
    };
    polling.current = setInterval(poll, 1_500);
    poll();
    return () => { if (polling.current) clearInterval(polling.current); };
  }, []);

  const train = useCallback(async (
    totalTimesteps = 5000,
    simSteps = 100,
    maxSwaps = 20,
  ) => {
    await fetch(`${API}/rl/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total_timesteps: totalTimesteps,
        sim_steps: simSteps,
        max_swaps: maxSwaps,
      }),
    });
  }, []);

  const stop = useCallback(async () => {
    await fetch(`${API}/rl/stop`, { method: "POST" });
  }, []);

  const apply = useCallback(async () => {
    const r = await fetch(`${API}/rl/apply`, { method: "POST" });
    return r.ok;
  }, []);

  return { rl, train, stop, apply };
}
