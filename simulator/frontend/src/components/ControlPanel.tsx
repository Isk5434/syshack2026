/**
 * ControlPanel – What-if Analysis sliders + playback controls.
 *
 * Every slider change immediately posts to /config,
 * so managers see the effect in real-time (the core demo hook).
 */
import React, { useState } from "react";
import {
  Play, Pause, RotateCcw, ChevronRight,
  Users, Ticket, UtensilsCrossed, Zap, Eye
} from "lucide-react";
import type { SimConfig } from "../types";

interface Props {
  config:       SimConfig | null;
  running:      boolean;
  connected:    boolean;
  showHeatmap:  boolean;
  onPlay:       () => void;
  onPause:      () => void;
  onReset:      () => void;
  onStep:       (n: number) => void;
  onSetSpeed:   (sps: number) => void;
  onConfig:     (cfg: Partial<SimConfig>) => void;
  onHeatmap:    (v: boolean) => void;
}

interface SliderProps {
  label:    string;
  icon:     React.ReactNode;
  value:    number;
  min:      number;
  max:      number;
  step:     number;
  unit?:    string;
  color:    string;
  onChange: (v: number) => void;
}

const Slider: React.FC<SliderProps> = ({
  label, icon, value, min, max, step, unit = "", color, onChange,
}) => (
  <div className="mb-4">
    <div className="flex justify-between items-center mb-1">
      <span className="flex items-center gap-1.5 text-xs text-gray-300">
        {icon} {label}
      </span>
      <span className={`text-sm font-bold ${color}`}>
        {Number.isInteger(step) ? value : value.toFixed(1)}{unit}
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
      style={{
        background: `linear-gradient(to right, ${color.replace("text-", "").replace("-400","")
          .replace("emerald","#34d399").replace("blue","#60a5fa")
          .replace("orange","#fb923c").replace("yellow","#facc15")
          .replace("purple","#c084fc")} ${((value-min)/(max-min))*100}%, #374151 0)`,
      }}
    />
  </div>
);

export const ControlPanel: React.FC<Props> = ({
  config, running, connected,
  showHeatmap,
  onPlay, onPause, onReset, onStep, onSetSpeed, onConfig, onHeatmap,
}) => {
  const [speed, setSpeed] = useState(2);

  if (!config) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        {connected ? "初期化中…" : "バックエンドに接続中…"}
      </div>
    );
  }

  const handleSpeed = (v: number) => {
    setSpeed(v);
    onSetSpeed(v);
  };

  return (
    <div className="space-y-5">
      {/* Connection indicator */}
      <div className={`flex items-center gap-2 text-xs ${connected ? "text-emerald-400" : "text-red-400"}`}>
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
        {connected ? "バックエンド接続済" : "接続待機中…"}
      </div>

      {/* Playback controls */}
      <div className="flex gap-2">
        <button
          onClick={running ? onPause : onPlay}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all
            ${running
              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
            }`}
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
          {running ? "一時停止" : "開始"}
        </button>
        <button
          onClick={() => onStep(10)}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-all"
        >
          <ChevronRight size={12} />10
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-gray-400 border border-gray-600 hover:bg-gray-700 transition-all"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Simulation speed */}
      <Slider
        label="シミュレーション速度"
        icon={<Zap size={12} />}
        value={speed}
        min={0.5} max={15} step={0.5}
        unit=" sps"
        color="text-yellow-400"
        onChange={handleSpeed}
      />

      {/* ── What-if sliders ──────────────────────────────────── */}
      <div className="border-t border-gray-700 pt-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">
          What-if 分析
        </p>

        <Slider
          label="スタッフ人数"
          icon={<Users size={12} />}
          value={config.n_staff}
          min={1} max={8} step={1}
          unit=" 人"
          color="text-emerald-400"
          onChange={(v) => onConfig({ n_staff: Math.round(v) })}
        />

        <Slider
          label="食券機台数"
          icon={<Ticket size={12} />}
          value={config.n_ticket_machines}
          min={1} max={5} step={1}
          unit=" 台"
          color="text-orange-400"
          onChange={(v) => onConfig({ n_ticket_machines: Math.round(v) })}
        />

        <Slider
          label="来客レート (λ)"
          icon={<Users size={12} />}
          value={config.spawn_rate}
          min={0.1} max={3.0} step={0.1}
          unit=" /step"
          color="text-blue-400"
          onChange={(v) => onConfig({ spawn_rate: v })}
        />

        <Slider
          label="調理時間 (μ⁻¹)"
          icon={<UtensilsCrossed size={12} />}
          value={config.staff_service_time}
          min={2} max={25} step={1}
          unit=" steps"
          color="text-purple-400"
          onChange={(v) => onConfig({ staff_service_time: Math.round(v) })}
        />
      </div>

      {/* Display toggle */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-700">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <Eye size={12} /> ヒートマップ
        </span>
        <button
          onClick={() => onHeatmap(!showHeatmap)}
          className={`w-10 h-5 rounded-full transition-all relative ${showHeatmap ? "bg-red-500" : "bg-gray-600"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${showHeatmap ? "left-5" : "left-0.5"}`} />
        </button>
      </div>

      {/* Legend */}
      <div className="bg-gray-800/50 rounded-lg p-3 text-xs space-y-1.5">
        <p className="text-gray-500 uppercase tracking-widest text-xs mb-2">凡例</p>
        {[
          ["#a3e635", "入店中"],
          ["#facc15", "券購入中"],
          ["#38bdf8", "着席へ移動"],
          ["#fb923c", "席で料理待ち"],
          ["#f59e0b", "料理受取中"],
          ["#818cf8", "食事中"],
          ["#c084fc", "返却中"],
          ["#f87171", "退店中"],
          ["#34d399", "スタッフ"],
        ].map(([color, label]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-gray-300">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
