import React, { useState } from "react";
import { SimulationCanvas } from "./components/SimulationCanvas";
import { ControlPanel }     from "./components/ControlPanel";
import { StatsPanel }       from "./components/StatsPanel";
import { useSimulation }    from "./hooks/useSimulation";

export default function App() {
  const {
    layout, state, connected, running,
    play, pause, reset, step, setSpeed, updateConfig,
  } = useSimulation();

  const [showHeatmap, setShowHeatmap] = useState(true);

  // Responsive cell size: fill available width
  const canvasAreaW = typeof window !== "undefined"
    ? Math.max(400, window.innerWidth - 680)
    : 640;
  const cellSize = layout
    ? Math.floor(Math.min(canvasAreaW / layout.W, (window.innerHeight - 80) / layout.H))
    : 16;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900/80 border-b border-gray-800 backdrop-blur">
        <div>
          <h1 className="text-base font-bold tracking-tight">
            🍱 学食混雑最適化シミュレーター
          </h1>
          <p className="text-xs text-gray-500">
            Multi-Agent Simulation × Queueing Theory × A* Pathfinding
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state && (
            <span className="text-xs text-gray-400 font-mono">
              {state.students.length} agents &nbsp;|&nbsp;
              step {state.step}
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded-full border ${
            connected
              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
              : "text-red-400 border-red-500/30 bg-red-500/10"
          }`}>
            {connected ? "● LIVE" : "● OFFLINE"}
          </span>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center bg-gray-950 p-4 overflow-auto">
          {layout ? (
            <SimulationCanvas
              layout={layout}
              state={state}
              showHeatmap={showHeatmap}
              cellSize={cellSize}
            />
          ) : (
            <div className="text-gray-600 text-sm animate-pulse">
              バックエンド起動待機中…<br />
              <code className="text-xs">uvicorn main:app --port 8000</code>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-80 flex flex-col border-l border-gray-800 bg-gray-900/60 backdrop-blur overflow-y-auto">

          {/* Control Panel */}
          <div className="p-4 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              コントロール
            </p>
            <ControlPanel
              config={state?.config ?? null}
              running={running}
              connected={connected}
              showHeatmap={showHeatmap}
              onPlay={play}
              onPause={pause}
              onReset={reset}
              onStep={step}
              onSetSpeed={setSpeed}
              onConfig={updateConfig}
              onHeatmap={setShowHeatmap}
            />
          </div>

          {/* Stats Panel */}
          <div className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              リアルタイム分析
            </p>
            <StatsPanel
              stats={state?.stats ?? null}
              step={state?.step ?? 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
