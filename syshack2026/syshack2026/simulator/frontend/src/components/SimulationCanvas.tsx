/**
 * SimulationCanvas
 *
 * Renders the grid, agents, and density heatmap on an HTML Canvas.
 * Each frame:
 *   1. Draw base tiles (node type colours)
 *   2. Overlay density heatmap (red channel transparency)
 *   3. Draw agent dots (colour-coded by FSM state)
 *   4. Draw queue length indicators
 */
import React, { useEffect, useRef } from "react";
import type { GridLayout, SimState } from "../types";

// ── Colour palettes ──────────────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  wall:    "#111827",
  floor:   "#1e293b",
  entry:   "#14532d",
  ticket:  "#854d0e",
  counter: "#7c2d12",
  seat:    "#1e3a5f",
  return:  "#581c87",
};

const AGENT_COLORS: Record<string, string> = {
  entering:       "#a3e635",
  buying_ticket:  "#facc15",
  finding_seat:   "#38bdf8",
  waiting_food:   "#fb923c",
  picking_up:     "#f472b6",
  eating:         "#818cf8",
  returning_tray: "#c084fc",
  exiting:        "#f87171",
  left:           "transparent",
};

const STAFF_COLOR = "#34d399";

interface Props {
  layout:      GridLayout;
  state:       SimState | null;
  showHeatmap: boolean;
  cellSize?:   number;
}

export const SimulationCanvas: React.FC<Props> = ({
  layout,
  state,
  showHeatmap,
  cellSize = 16,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const canvasW = layout.W * cellSize;
  const canvasH = layout.H * cellSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);

    // ── 1. Base tiles ──────────────────────────────────────────────
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        const nodeType = layout.cells[y]?.[x] ?? "wall";
        ctx.fillStyle = NODE_COLORS[nodeType] ?? NODE_COLORS.floor;
        ctx.fillRect(x * cellSize, (layout.H - 1 - y) * cellSize, cellSize, cellSize);
      }
    }

    // Grid lines (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= layout.W; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, canvasH);
      ctx.stroke();
    }
    for (let y = 0; y <= layout.H; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(canvasW, y * cellSize);
      ctx.stroke();
    }

    if (!state) return;

    // ── 2. Heatmap overlay ────────────────────────────────────────
    if (showHeatmap) {
      for (let y = 0; y < layout.H; y++) {
        for (let x = 0; x < layout.W; x++) {
          const d = state.heatmap[y]?.[x] ?? 0;
          if (d > 0.05) {
            ctx.fillStyle = `rgba(239,68,68,${Math.min(0.75, d * 0.8)})`;
            ctx.fillRect(x * cellSize, (layout.H - 1 - y) * cellSize, cellSize, cellSize);
          }
        }
      }
    }

    // ── 3. Node labels ────────────────────────────────────────────
    ctx.font = `${Math.max(7, cellSize * 0.5)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < layout.H; y++) {
      for (let x = 0; x < layout.W; x++) {
        const nt = layout.cells[y]?.[x];
        const cx = x * cellSize + cellSize / 2;
        const cy = (layout.H - 1 - y) * cellSize + cellSize / 2;
        if (nt === "ticket")  { ctx.fillStyle = "#fbbf24"; ctx.fillText("T", cx, cy); }
        if (nt === "counter") { ctx.fillStyle = "#f97316"; ctx.fillText("C", cx, cy); }
        if (nt === "return")  { ctx.fillStyle = "#d8b4fe"; ctx.fillText("R", cx, cy); }
        if (nt === "entry")   { ctx.fillStyle = "#4ade80"; ctx.fillText("E", cx, cy); }
      }
    }

    // ── 4. Staff agents ───────────────────────────────────────────
    const r_staff = cellSize * 0.45;
    for (const s of state.staff) {
      const cx = s.x * cellSize + cellSize / 2;
      const cy = (layout.H - 1 - s.y) * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r_staff, 0, Math.PI * 2);
      ctx.fillStyle = s.state === "serving" ? "#10b981" : "#6b7280";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── 5. Student agents ─────────────────────────────────────────
    const r_agent = cellSize * 0.32;
    for (const a of state.students) {
      const cx = a.x * cellSize + cellSize / 2;
      const cy = (layout.H - 1 - a.y) * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r_agent, 0, Math.PI * 2);
      ctx.fillStyle = AGENT_COLORS[a.state] ?? "#ffffff";
      ctx.fill();
    }

    // ── 6. Queue length badges ────────────────────────────────────
    const drawBadge = (x: number, y: number, label: string, n: number, color: string) => {
      const bx = x * cellSize;
      const by = (layout.H - 1 - y) * cellSize - cellSize;
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, cellSize * 1.6, cellSize * 0.8);
      ctx.fillStyle = "#000";
      ctx.font = `bold ${cellSize * 0.5}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`${label}${n}`, bx + cellSize * 0.8, by + cellSize * 0.45);
    };

    state.queue_lengths.ticket.forEach((n, i) => {
      if (i < layout.W) {
        const pos = layout.cells.flat().indexOf("ticket");
        if (pos >= 0) {
          const tx = pos % layout.W;
          const ty = Math.floor(pos / layout.W);
          drawBadge(tx, ty + i * 3, "Q", n, n > 5 ? "#ef4444" : "#facc15");
        }
      }
    });

  }, [layout, state, showHeatmap, cellSize, canvasW, canvasH]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      style={{ imageRendering: "pixelated", display: "block" }}
      className="rounded-lg border border-gray-700"
    />
  );
};
