"""
CafeteriaModel – Mesa Model orchestrating the full simulation.

Key design decisions:
  - MultiGrid: allows agent stacking (realistic crowds)
  - RandomActivation: agents step in randomised order (avoids lock-step artefacts)
  - Queues: Python deques managed by the Model (not spatial Mesa queues)
    → O(1) enqueue/dequeue, trivial "what-if" resizing

M/M/c queue theory check:
    ρ = λ / (c * μ)   where λ=spawn_rate, c=n_staff, μ=1/service_time
    Simulation should match analytic E[W] = ρ / (c*μ*(1-ρ)) for validation.
"""
from __future__ import annotations

import collections
import random
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np
from mesa import Model
from mesa.space import MultiGrid
from mesa.time import RandomActivation

from agents import AgentState, StaffAgent, StudentAgent
from grid_layout import GRID_H, GRID_W, GridLayout
from pathfinding import astar, compute_density

Pos = Tuple[int, int]

# Ticket machine auto-processing (no staff needed for ticket vending)
TICKET_SERVICE_TIME = 3   # steps per student


class CafeteriaModel(Model):
    """
    Parameters (all runtime-adjustable via FastAPI)
    ------------------------------------------------
    spawn_rate          : float  – mean agents spawned per step (Poisson)
    n_staff             : int    – counter staff count
    n_ticket_machines   : int    – ticket machine count
    staff_service_time  : int    – mean steps to prepare one order
    """

    def __init__(
        self,
        spawn_rate:         float = 0.8,
        n_staff:            int   = 3,
        n_ticket_machines:  int   = 3,
        staff_service_time: int   = 10,
    ) -> None:
        super().__init__()

        # ── Configurable parameters ──────────────────────────────────
        self.spawn_rate         = spawn_rate
        self.n_staff            = n_staff
        self.n_ticket_machines  = n_ticket_machines
        self.staff_service_time = staff_service_time

        # ── Layout ───────────────────────────────────────────────────
        self.layout = GridLayout(n_ticket_machines, n_staff)

        # ── Mesa primitives ──────────────────────────────────────────
        self.grid     = MultiGrid(GRID_W, GRID_H, torus=False)
        self.schedule = RandomActivation(self)

        # ── Queues ───────────────────────────────────────────────────
        # ticket_queues[i] = FIFO list for ticket machine i
        self.ticket_queues:  List[Deque[StudentAgent]] = [
            collections.deque() for _ in range(n_ticket_machines)
        ]
        # counter_queues[i] = list for counter / staff i
        self.counter_queues: List[List[StudentAgent]] = [
            [] for _ in range(n_staff)
        ]

        # Seat availability set
        self._free_seats: List[Pos] = list(self.layout.seat_positions)
        random.shuffle(self._free_seats)

        # ── Statistics ───────────────────────────────────────────────
        self.step_count:          int   = 0
        self._next_id:            int   = 0
        self.total_served:        int   = 0
        self.total_revenue:       float = 0.0
        self.total_abandoned:     int   = 0
        self.wait_time_log:       List[int] = []   # per-customer wait steps
        self.throughput_history:  List[float] = []  # served/step (rolling)
        self._served_this_window: int   = 0
        self._window_size:        int   = 20        # steps per throughput sample

        # ── Ticket machine timers ────────────────────────────────────
        self._ticket_timers: List[int] = [0] * n_ticket_machines

        # ── Staff agents ─────────────────────────────────────────────
        for i in range(n_staff):
            pos = self.layout.counter_positions[i % len(self.layout.counter_positions)]
            staff = StaffAgent(
                unique_id=self._next_agent_id(),
                model=self,
                counter_idx=i,
                service_time=staff_service_time,
            )
            self.grid.place_agent(staff, pos)
            self.schedule.add(staff)

    # ------------------------------------------------------------------
    # Mesa hook
    # ------------------------------------------------------------------

    def step(self) -> None:
        self.step_count += 1

        # 1. Spawn new students (Poisson arrivals)
        n_new = np.random.poisson(self.spawn_rate)
        for _ in range(n_new):
            self._spawn_student()

        # 2. Tick ticket machines (auto-serve from queue)
        self._tick_ticket_machines()

        # 3. Activate all agents
        self.schedule.step()

        # 4. Throughput sampling
        if self.step_count % self._window_size == 0:
            rate = self._served_this_window / self._window_size
            self.throughput_history.append(round(rate, 3))
            self._served_this_window = 0

    # ------------------------------------------------------------------
    # Spawning
    # ------------------------------------------------------------------

    def _spawn_student(self) -> None:
        if not self.layout.entry_positions:
            return
        entry = random.choice(self.layout.entry_positions)

        # Allow stacking but limit max occupancy for realism
        if len(self.grid.get_cell_list_contents([entry])) >= 4:
            return

        student = StudentAgent(
            unique_id=self._next_agent_id(),
            model=self,
            patience=random.betavariate(4, 2),   # skewed toward patience
            group_size=random.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0],
        )
        self.grid.place_agent(student, entry)
        self.schedule.add(student)

    # ------------------------------------------------------------------
    # Queue management (called by agents)
    # ------------------------------------------------------------------

    def shortest_ticket_queue(self) -> Tuple[int, Pos]:
        idx = min(range(self.n_ticket_machines), key=lambda i: len(self.ticket_queues[i]))
        return idx, self.layout.ticket_positions[idx % len(self.layout.ticket_positions)]

    def ticket_wait_pos(self, idx: int) -> Pos:
        """Standing position just left of ticket machine."""
        tm_pos = self.layout.ticket_positions[idx % len(self.layout.ticket_positions)]
        x, y = tm_pos
        return (max(1, x - 1), y)

    def join_ticket_queue(self, student: StudentAgent, idx: int) -> None:
        self.ticket_queues[idx].append(student)

    def leave_ticket_queue(self, student: StudentAgent, idx: int) -> None:
        try:
            self.ticket_queues[idx].remove(student)
        except ValueError:
            pass

    def join_counter_queue(self, student: StudentAgent) -> None:
        idx = min(range(self.n_staff), key=lambda i: len(self.counter_queues[i]))
        student.counter_queue_idx = idx
        self.counter_queues[idx].append(student)
        student.state = AgentState.QUEUING_FOOD

        # Move student to waiting spot near counter
        wait_x = self.layout.counter_positions[idx % len(self.layout.counter_positions)][0] - 2
        wait_y = self.layout.counter_positions[idx % len(self.layout.counter_positions)][1]
        dest = (max(1, wait_x), wait_y)
        student.path = self.find_path(student.pos, dest)

    def leave_counter_queue(self, student: StudentAgent, idx: int) -> None:
        try:
            self.counter_queues[idx].remove(student)
        except ValueError:
            pass

    # ------------------------------------------------------------------
    # Ticket machine processing
    # ------------------------------------------------------------------

    def _tick_ticket_machines(self) -> None:
        for i in range(self.n_ticket_machines):
            if self._ticket_timers[i] > 0:
                self._ticket_timers[i] -= 1
            elif self.ticket_queues[i]:
                student = self.ticket_queues[i].popleft()
                if student.state == AgentState.BUYING_TICKET:
                    # Ticket issued → join food queue
                    self.join_counter_queue(student)
                self._ticket_timers[i] = TICKET_SERVICE_TIME

    # ------------------------------------------------------------------
    # Seat management
    # ------------------------------------------------------------------

    def claim_seat(self) -> Optional[Pos]:
        if self._free_seats:
            return self._free_seats.pop()
        return None

    def release_seat(self, pos: Pos) -> None:
        self._free_seats.append(pos)

    # ------------------------------------------------------------------
    # Statistics hooks (called by agents)
    # ------------------------------------------------------------------

    def record_served(self, student: StudentAgent) -> None:
        self.total_served       += 1
        self.total_revenue      += student.revenue
        self.wait_time_log.append(student.wait_steps)
        self._served_this_window += 1

    def record_abandonment(self) -> None:
        self.total_abandoned += 1

    def remove_agent(self, agent: StudentAgent) -> None:
        if agent.pos:
            self.grid.remove_agent(agent)
        self.schedule.remove(agent)

    # ------------------------------------------------------------------
    # Pathfinding (caches density each call)
    # ------------------------------------------------------------------

    def find_path(self, start: Optional[Pos], goal: Pos) -> List[Pos]:
        if start is None or start == goal:
            return []
        positions = [
            a.pos for a in self.schedule.agents
            if isinstance(a, StudentAgent) and a.pos
        ]
        density = compute_density(positions, GRID_W, GRID_H)
        path = astar(self.layout.passable, start, goal, density)
        return path[1:]  # exclude start position

    # ------------------------------------------------------------------
    # State serialisation
    # ------------------------------------------------------------------

    def collect_state(self) -> dict:
        student_agents = [
            a for a in self.schedule.agents if isinstance(a, StudentAgent)
        ]
        staff_agents = [
            a for a in self.schedule.agents if isinstance(a, StaffAgent)
        ]

        # Density heatmap (GRID_H × GRID_W)
        positions = [a.pos for a in student_agents if a.pos]
        density   = compute_density(positions, GRID_W, GRID_H)
        heatmap   = [
            [round(density.get((x, y), 0.0), 3) for x in range(GRID_W)]
            for y in range(GRID_H)
        ]

        avg_wait = (
            round(sum(self.wait_time_log[-200:]) / len(self.wait_time_log[-200:]), 1)
            if self.wait_time_log else 0.0
        )
        total_students = len(student_agents)
        seat_util = round(
            (len(self.layout.seat_positions) - len(self._free_seats))
            / max(1, len(self.layout.seat_positions)), 3
        )

        return {
            "step":    self.step_count,
            "students": [a.to_dict() for a in student_agents],
            "staff":    [a.to_dict() for a in staff_agents],
            "heatmap":  heatmap,
            "queue_lengths": {
                "ticket":  [len(q) for q in self.ticket_queues],
                "counter": [len(q) for q in self.counter_queues],
            },
            "stats": {
                "total_students":  total_students,
                "total_served":    self.total_served,
                "total_abandoned": self.total_abandoned,
                "avg_wait":        avg_wait,
                "revenue":         round(self.total_revenue, 0),
                "seat_utilisation": seat_util,
                "throughput_history": self.throughput_history[-60:],
                # M/M/c theoretical utilisation ρ = λ/(c*μ)
                "rho": round(
                    self.spawn_rate / max(1, self.n_staff * (1 / max(1, self.staff_service_time))), 3
                ),
            },
            "config": {
                "spawn_rate":         self.spawn_rate,
                "n_staff":            self.n_staff,
                "n_ticket_machines":  self.n_ticket_machines,
                "staff_service_time": self.staff_service_time,
            },
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_agent_id(self) -> int:
        self._next_id += 1
        return self._next_id
