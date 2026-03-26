// ── Grid ──────────────────────────────────────────────────────────────────

export type NodeType =
  | "wall" | "floor" | "entry" | "ticket" | "counter" | "seat" | "return";

export interface GridLayout {
  W: number;
  H: number;
  cells: NodeType[][];  // cells[y][x]
}

// ── Agents ────────────────────────────────────────────────────────────────

export type AgentState =
  | "entering" | "buying_ticket" | "finding_seat" | "waiting_food"
  | "picking_up" | "eating" | "returning_tray" | "exiting" | "left";

export type MenuType = "teishoku" | "ramen" | "light";

export interface StudentData {
  id:    number;
  x:     number;
  y:     number;
  state: AgentState;
  menu:  MenuType;
}

export interface StaffData {
  id:      number;
  x:       number;
  y:       number;
  state:   "serving" | "idle";
  counter: number;
}

// ── Statistics ────────────────────────────────────────────────────────────

export interface SimStats {
  total_students:   number;
  total_served:     number;
  total_abandoned:  number;
  avg_wait:         number;
  revenue:          number;
  seat_utilisation: number;
  throughput_history: number[];
  rho:              number;  // M/M/c utilisation factor
}

export interface QueueLengths {
  ticket:  number[];
  counter: number[];
}

// ── Simulation config ─────────────────────────────────────────────────────

export interface SimConfig {
  spawn_rate:         number;
  n_staff:            number;
  n_ticket_machines:  number;
  staff_service_time: number;
}

// ── Full state snapshot ───────────────────────────────────────────────────

export interface SimState {
  step:          number;
  students:      StudentData[];
  staff:         StaffData[];
  heatmap:       number[][];   // [y][x] normalised 0-1
  queue_lengths: QueueLengths;
  stats:         SimStats;
  config:        SimConfig;
}

// ── Editor / Legend ───────────────────────────────────────────────────────
export const NODE_TYPES: NodeType[] = ["wall","floor","entry","ticket","counter","seat","return"];

export const NODE_LABELS: Record<NodeType, string> = {
  wall:    "壁",
  floor:   "通路",
  entry:   "入口",
  ticket:  "券売機",
  counter: "カウンター",
  seat:    "席",
  return:  "返却台",
};

export const NODE_COLORS_CSS: Record<NodeType, string> = {
  wall:    "#111827",
  floor:   "#1e293b",
  entry:   "#14532d",
  ticket:  "#854d0e",
  counter: "#7c2d12",
  seat:    "#1e3a5f",
  return:  "#581c87",
};

export const AGENT_LABELS: Record<string, string> = {
  entering:       "入店中",
  buying_ticket:  "券購入中",
  finding_seat:   "着席へ移動",
  waiting_food:   "席で料理待ち",
  picking_up:     "料理受取中",
  eating:         "食事中",
  returning_tray: "返却中",
  exiting:        "退店中",
};
