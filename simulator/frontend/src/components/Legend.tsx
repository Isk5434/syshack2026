import React from "react";
import { NODE_COLORS_CSS, NODE_LABELS, NODE_TYPES } from "../types";

const AGENT_COLORS_CSS: Record<string, string> = {
  entering:       "#a3e635",
  buying_ticket:  "#facc15",
  finding_seat:   "#38bdf8",
  waiting_food:   "#fb923c",
  picking_up:     "#f59e0b",
  eating:         "#818cf8",
  returning_tray: "#c084fc",
  exiting:        "#f87171",
};

const AGENT_LABELS_MAP: Record<string, string> = {
  entering:       "入店中",
  buying_ticket:  "券購入中",
  finding_seat:   "着席へ移動",
  waiting_food:   "席で料理待ち",
  picking_up:     "料理受取中",
  eating:         "食事中",
  returning_tray: "返却中",
  exiting:        "退店中",
};

export const Legend: React.FC = () => (
  <div className="p-4 border-t border-gray-800">
    <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">凡例</p>

    <p className="text-xs text-gray-400 mb-1 font-medium">場所</p>
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3">
      {NODE_TYPES.filter(nt => nt !== "wall" && nt !== "floor").map(nt => (
        <div key={nt} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
            style={{ background: NODE_COLORS_CSS[nt] }}
          />
          <span className="text-xs text-gray-300">{NODE_LABELS[nt]}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#1e293b" }} />
        <span className="text-xs text-gray-300">通路</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm flex-shrink-0" style={{ background: "#111827" }} />
        <span className="text-xs text-gray-300">壁</span>
      </div>
    </div>

    <p className="text-xs text-gray-400 mb-1 font-medium">エージェント状態</p>
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {Object.entries(AGENT_LABELS_MAP).map(([state, label]) => (
        <div key={state} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
            style={{ background: AGENT_COLORS_CSS[state] }}
          />
          <span className="text-xs text-gray-300">{label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-full flex-shrink-0 border border-gray-500" style={{ background: "#34d399" }} />
        <span className="text-xs text-gray-300">スタッフ</span>
      </div>
    </div>
  </div>
);
