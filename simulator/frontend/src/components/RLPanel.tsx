/**
 * RLPanel – Controls and visualisation for reinforcement learning layout optimisation.
 *
 * Shows:
 *   - Training parameters (timesteps, sim steps, max swaps)
 *   - Start / Stop / Apply buttons
 *   - Progress bar + elapsed time
 *   - Best reward + mini reward chart (sparkline)
 */
import React, { useState } from "react";
import { Brain, Square, Zap, BarChart3, CheckCircle } from "lucide-react";
import type { RLStatus } from "../hooks/useRL";

interface Props {
  rl:     RLStatus;
  onTrain: (ts: number, sim: number, swaps: number) => void;
  onStop:  () => void;
  onApply: () => void;
}

export const RLPanel: React.FC<Props> = ({ rl, onTrain, onStop, onApply }) => {
  const [timesteps, setTimesteps]  = useState(5000);
  const [simSteps, setSimSteps]    = useState(100);
  const [maxSwaps, setMaxSwaps]    = useState(20);

  const isTraining = rl.is_training;
  const isDone     = rl.status === "completed" || rl.status === "stopped";
  const hasResult  = rl.best_layout !== null;
  const isError    = rl.status.startsWith("error");

  // Mini sparkline
  const rewards = rl.recent_rewards;
  const rMin = rewards.length ? Math.min(...rewards) : 0;
  const rMax = rewards.length ? Math.max(...rewards) : 1;
  const rRange = Math.max(rMax - rMin, 0.01);

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Brain size={14} className={isTraining ? "text-purple-400 animate-pulse" : "text-gray-500"} />
        <span className={`text-xs font-medium ${
          isTraining ? "text-purple-400" :
          isDone     ? "text-emerald-400" :
          isError    ? "text-red-400" :
                       "text-gray-500"
        }`}>
          {isTraining ? "学習中…" :
           rl.status === "completed" ? "学習完了" :
           rl.status === "stopped" ? "停止済" :
           isError ? "エラー" :
           "待機中"}
        </span>
        {isTraining && (
          <span className="text-xs text-gray-500 ml-auto font-mono">
            {rl.elapsed_sec}s
          </span>
        )}
      </div>

      {/* Progress bar */}
      {(isTraining || isDone) && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400">
            <span>進捗: {rl.progress}%</span>
            <span>{rl.current_timestep} / {rl.total_timesteps}</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isTraining ? "bg-purple-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, rl.progress)}%` }}
            />
          </div>
        </div>
      )}

      {/* Best reward */}
      {rl.best_reward !== null && (
        <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-2.5">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <BarChart3 size={12} /> ベスト報酬
          </span>
          <span className="text-sm font-bold text-yellow-400">
            {rl.best_reward.toFixed(1)}
          </span>
        </div>
      )}

      {/* Reward sparkline */}
      {rewards.length > 1 && (
        <div className="bg-gray-800/50 rounded-lg p-2.5">
          <p className="text-xs text-gray-500 mb-1">エピソード報酬推移</p>
          <svg viewBox={`0 0 ${rewards.length} 30`} className="w-full h-8" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="#a78bfa"
              strokeWidth="1.5"
              points={rewards.map((r, i) =>
                `${i},${30 - ((r - rMin) / rRange) * 28}`
              ).join(" ")}
            />
          </svg>
        </div>
      )}

      {/* Parameters (only when not training) */}
      {!isTraining && (
        <div className="space-y-3 border-t border-gray-700 pt-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            学習パラメータ
          </p>

          <div className="space-y-2">
            <label className="flex justify-between text-xs text-gray-400">
              <span>総タイムステップ</span>
              <span className="font-mono text-gray-300">{timesteps.toLocaleString()}</span>
            </label>
            <input
              type="range" min={500} max={50000} step={500}
              value={timesteps}
              onChange={e => setTimesteps(+e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-gray-700"
            />
          </div>

          <div className="space-y-2">
            <label className="flex justify-between text-xs text-gray-400">
              <span>評価シミュレーション長</span>
              <span className="font-mono text-gray-300">{simSteps} steps</span>
            </label>
            <input
              type="range" min={30} max={300} step={10}
              value={simSteps}
              onChange={e => setSimSteps(+e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-gray-700"
            />
          </div>

          <div className="space-y-2">
            <label className="flex justify-between text-xs text-gray-400">
              <span>最大スワップ/エピソード</span>
              <span className="font-mono text-gray-300">{maxSwaps}</span>
            </label>
            <input
              type="range" min={5} max={60} step={5}
              value={maxSwaps}
              onChange={e => setMaxSwaps(+e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-gray-700"
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {!isTraining ? (
          <button
            onClick={() => onTrain(timesteps, simSteps, maxSwaps)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold
              bg-purple-600/30 text-purple-300 border border-purple-500/30 hover:bg-purple-600/50 transition-all"
          >
            <Zap size={14} /> 学習開始
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold
              bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 transition-all"
          >
            <Square size={14} /> 停止
          </button>
        )}

        {hasResult && !isTraining && (
          <button
            onClick={onApply}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold
              bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-all"
          >
            <CheckCircle size={14} /> 適用
          </button>
        )}
      </div>

      {/* Error message */}
      {isError && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded p-2">
          {rl.status}
        </div>
      )}
    </div>
  );
};
