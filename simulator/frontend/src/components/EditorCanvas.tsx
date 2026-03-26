/**
 * EditorCanvas
 * Interactive grid editor: click to place tiles, right-click to erase.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GridLayout, NodeType } from "../types";
import { NODE_COLORS_CSS, NODE_LABELS, NODE_TYPES } from "../types";

const NODE_COLORS: Record<string, string> = {
  wall:    "#111827",
  floor:   "#1e293b",
  entry:   "#14532d",
  ticket:  "#854d0e",
  counter: "#7c2d12",
  seat:    "#1e3a5f",
  return:  "#581c87",
};

interface Props {
  layout:     GridLayout;
  cellSize?:  number;
  onApply:    (cells: NodeType[][]) => void;
}

export const EditorCanvas: React.FC<Props> = ({ layout, cellSize = 16, onApply }) => {
  // Local mutable copy of cells
  const [cells, setCells] = useState<NodeType[][]>(() =>
    layout.cells.map(row => [...row] as NodeType[])
  );
  const [selectedType, setSelectedType] = useState<NodeType>("seat");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const canvasW = layout.W * cellSize;
  const canvasH = layout.H * cellSize;

  // Reset when layout changes
  useEffect(() => {
    setCells(layout.cells.map(row => [...row] as NodeType[]));
  }, [layout]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        const nt = cells[y]?.[x] ?? "wall";
        ctx.fillStyle = NODE_COLORS[nt] ?? NODE_COLORS.floor;
        ctx.fillRect(x * cellSize, (layout.H - 1 - y) * cellSize, cellSize, cellSize);
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= layout.W; x++) {
      ctx.beginPath(); ctx.moveTo(x * cellSize, 0); ctx.lineTo(x * cellSize, canvasH); ctx.stroke();
    }
    for (let y = 0; y <= layout.H; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * cellSize); ctx.lineTo(canvasW, y * cellSize); ctx.stroke();
    }

    // Labels
    ctx.font = `${Math.max(7, cellSize * 0.5)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        const nt = cells[y]?.[x];
        const cx = x * cellSize + cellSize / 2;
        const cy = (layout.H - 1 - y) * cellSize + cellSize / 2;
        if (nt === "ticket")  { ctx.fillStyle = "#fbbf24"; ctx.fillText("T", cx, cy); }
        if (nt === "counter") { ctx.fillStyle = "#f97316"; ctx.fillText("C", cx, cy); }
        if (nt === "return")  { ctx.fillStyle = "#d8b4fe"; ctx.fillText("R", cx, cy); }
        if (nt === "entry")   { ctx.fillStyle = "#4ade80"; ctx.fillText("E", cx, cy); }
        if (nt === "seat")    { ctx.fillStyle = "#93c5fd"; ctx.fillText("S", cx, cy); }
      }
    }
  }, [cells, layout, cellSize, canvasW, canvasH]);

  const paintCell = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const gx = Math.floor(px / cellSize);
    const gy = layout.H - 1 - Math.floor(py / cellSize);
    if (gx < 0 || gx >= layout.W || gy < 0 || gy >= layout.H) return;
    const type = e.buttons === 2 ? "floor" as NodeType : selectedType;
    setCells(prev => {
      const next = prev.map(r => [...r]);
      next[gy][gx] = type;
      return next;
    });
  }, [cellSize, layout.H, layout.W, selectedType]);

  return (
    <div className="flex flex-col gap-3 items-center">
      {/* Palette */}
      <div className="flex flex-wrap gap-2 justify-center">
        {NODE_TYPES.map(nt => (
          <button
            key={nt}
            onClick={() => setSelectedType(nt)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-all ${
              selectedType === nt
                ? "border-white scale-105 shadow-lg"
                : "border-gray-600 opacity-70 hover:opacity-100"
            }`}
            style={{ background: NODE_COLORS_CSS[nt] }}
          >
            <span className="text-white">{NODE_LABELS[nt]}</span>
          </button>
        ))}
        <div className="text-xs text-gray-500 self-center ml-2">右クリック: 通路に戻す</div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{ imageRendering: "pixelated", cursor: "crosshair" }}
        className="rounded-lg border border-blue-500/50"
        onMouseDown={paintCell}
        onMouseMove={e => { if (e.buttons > 0) paintCell(e); }}
        onContextMenu={e => { e.preventDefault(); paintCell(e); }}
      />

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setCells(layout.cells.map(r => [...r] as NodeType[]))}
          className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
        >
          リセット
        </button>
        <button
          onClick={() => onApply(cells)}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-sm font-bold"
        >
          レイアウト適用
        </button>
      </div>
    </div>
  );
};
