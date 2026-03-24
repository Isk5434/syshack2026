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
  | "entering" | "buying_ticket" | "queuing_food" | "finding_seat"
  | "eating" | "returning_tray" | "exiting" | "left";

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
