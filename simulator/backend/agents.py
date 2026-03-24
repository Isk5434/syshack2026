"""
Agent definitions for cafeteria MAS.

StudentAgent implements a Finite State Machine (FSM):

  ENTERING → BUYING_TICKET → QUEUING_FOOD → FINDING_SEAT
           → EATING → RETURNING_TRAY → EXITING → (removed)

Abandonment follows an exponential survival function:
    P(abandon | wait=t) = 1 - exp(-λ * t)
where λ = (1 - patience) / avg_service_time

This is grounded in Queueing Theory (M/M/c model intuition) and
makes the simulation academically defensible for the hackathon.

StaffAgent processes the counter queue at a fixed service rate.
"""
from __future__ import annotations

import math
import random
from enum import Enum
from typing import TYPE_CHECKING, List, Optional, Tuple

from mesa import Agent

if TYPE_CHECKING:
    from model import CafeteriaModel

Pos = Tuple[int, int]


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class AgentState(str, Enum):
    ENTERING       = "entering"
    BUYING_TICKET  = "buying_ticket"
    QUEUING_FOOD   = "queuing_food"
    FINDING_SEAT   = "finding_seat"
    EATING         = "eating"
    RETURNING_TRAY = "returning_tray"
    EXITING        = "exiting"
    LEFT           = "left"


class MenuType(str, Enum):
    TEISHOKU = "teishoku"   # 定食 ¥850, prep 12-18 steps
    RAMEN    = "ramen"      # 麺類 ¥680, prep 8-12 steps
    LIGHT    = "light"      # 軽食 ¥450, prep 4-7 steps


MENU_PRICE:    dict[MenuType, int] = {MenuType.TEISHOKU: 850, MenuType.RAMEN: 680, MenuType.LIGHT: 450}
MENU_PREP:     dict[MenuType, Tuple[int, int]] = {
    MenuType.TEISHOKU: (12, 18),
    MenuType.RAMEN:    (8,  12),
    MenuType.LIGHT:    (4,   7),
}
MENU_EAT:      dict[MenuType, Tuple[int, int]] = {
    MenuType.TEISHOKU: (20, 30),
    MenuType.RAMEN:    (15, 22),
    MenuType.LIGHT:    (8,  14),
}
MENU_WEIGHTS = [0.45, 0.35, 0.20]     # probability of each menu choice


# ---------------------------------------------------------------------------
# Student Agent
# ---------------------------------------------------------------------------

class StudentAgent(Agent):
    """
    One dining customer.

    Attributes
    ----------
    patience   : float [0,1]  – higher = tolerates longer queues
    group_size : int          – cosmetic (affects revenue: group orders together)
    menu       : MenuType     – chosen at spawn
    state      : AgentState   – current FSM state
    wait_steps : int          – cumulative steps spent waiting in queues
    """

    def __init__(
        self,
        unique_id:  int,
        model:      "CafeteriaModel",
        patience:   float,
        group_size: int = 1,
    ) -> None:
        super().__init__(unique_id, model)
        self.patience   = float(patience)
        self.group_size = group_size
        self.menu       = random.choices(list(MenuType), weights=MENU_WEIGHTS)[0]
        self.state      = AgentState.ENTERING

        # Revenue contributed when served
        self.revenue = MENU_PRICE[self.menu] * group_size

        # Timing counters
        self.wait_steps:   int = 0   # total queue wait
        self.action_timer: int = 0   # countdown for timed states (eating, etc.)

        # Pathfinding
        self.path:       List[Pos] = []
        self.target_pos: Optional[Pos] = None

        # Assigned resources
        self.ticket_queue_idx:  Optional[int] = None
        self.counter_queue_idx: Optional[int] = None
        self.seat_pos:          Optional[Pos] = None

        # Abandonment: Poisson-process rate  λ = (1-patience) * base_rate
        self._abandon_rate: float = max(0.005, (1.0 - patience) * 0.03)

    # ------------------------------------------------------------------
    # Mesa hook
    # ------------------------------------------------------------------

    def step(self) -> None:
        dispatch = {
            AgentState.ENTERING:       self._entering,
            AgentState.BUYING_TICKET:  self._buying_ticket,
            AgentState.QUEUING_FOOD:   self._queuing_food,
            AgentState.FINDING_SEAT:   self._finding_seat,
            AgentState.EATING:         self._eating,
            AgentState.RETURNING_TRAY: self._returning_tray,
            AgentState.EXITING:        self._exiting,
        }
        handler = dispatch.get(self.state)
        if handler:
            handler()

    # ------------------------------------------------------------------
    # State handlers
    # ------------------------------------------------------------------

    def _entering(self) -> None:
        """Move to nearest ticket queue and join it."""
        if not self.path:
            idx, dest = self.model.shortest_ticket_queue()
            self.ticket_queue_idx = idx
            wait_pos = self.model.ticket_wait_pos(idx)
            self.path = self.model.find_path(self.pos, wait_pos)

        moved = self._move()
        if moved and not self.path:
            self.model.join_ticket_queue(self, self.ticket_queue_idx)
            self.state = AgentState.BUYING_TICKET

    def _buying_ticket(self) -> None:
        """Wait until served by ticket machine, or abandon."""
        self.wait_steps += 1
        if self._should_abandon():
            self._abandon("ticket_queue")
            return
        # Model's StaffAgent / tick machine serves from queue → signals via model

    def _queuing_food(self) -> None:
        """Wait at counter queue until food is ready, or abandon."""
        self.wait_steps += 1
        if self._should_abandon():
            self._abandon("counter_queue")
            return

    def _finding_seat(self) -> None:
        """Pathfind to reserved seat."""
        if not self.path and self.seat_pos:
            self.path = self.model.find_path(self.pos, self.seat_pos)

        moved = self._move()
        if moved and not self.path:
            self.action_timer = random.randint(*MENU_EAT[self.menu])
            self.state = AgentState.EATING

    def _eating(self) -> None:
        """Stay at seat for eat duration."""
        self.action_timer -= 1
        if self.action_timer <= 0:
            self.state = AgentState.RETURNING_TRAY
            ret = self.model.layout.return_positions[0]
            self.path = self.model.find_path(self.pos, ret)

    def _returning_tray(self) -> None:
        """Walk to return desk."""
        moved = self._move()
        if moved and not self.path:
            # Release seat
            if self.seat_pos:
                self.model.release_seat(self.seat_pos)
                self.seat_pos = None
            self.state = AgentState.EXITING
            exit_pos = random.choice(self.model.layout.entry_positions)
            self.path = self.model.find_path(self.pos, exit_pos)

    def _exiting(self) -> None:
        """Walk to exit, then remove from simulation."""
        moved = self._move()
        if moved and not self.path:
            self.state = AgentState.LEFT
            self.model.remove_agent(self)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _move(self) -> bool:
        """
        Advance one step along current path.
        Returns True when the last step was taken (path exhausted).
        """
        if not self.path:
            return True
        next_pos = self.path.pop(0)
        self.model.grid.move_agent(self, next_pos)
        return len(self.path) == 0

    def _should_abandon(self) -> bool:
        """
        Probabilistic abandonment based on exponential hazard.
        P(leave this step) = 1 - exp(-λ)  ≈ λ for small λ.
        """
        p_leave = 1.0 - math.exp(-self._abandon_rate)
        return random.random() < p_leave

    def _abandon(self, queue_type: str) -> None:
        self.model.record_abandonment()
        if queue_type == "ticket_queue" and self.ticket_queue_idx is not None:
            self.model.leave_ticket_queue(self, self.ticket_queue_idx)
        if queue_type == "counter_queue" and self.counter_queue_idx is not None:
            self.model.leave_counter_queue(self, self.counter_queue_idx)
        self.state = AgentState.EXITING
        exit_pos = random.choice(self.model.layout.entry_positions)
        self.path = self.model.find_path(self.pos, exit_pos)

    def to_dict(self) -> dict:
        x, y = self.pos if self.pos else (-1, -1)
        return {
            "id":    self.unique_id,
            "x":     x,
            "y":     y,
            "state": self.state.value,
            "menu":  self.menu.value,
        }


# ---------------------------------------------------------------------------
# Staff Agent
# ---------------------------------------------------------------------------

class StaffAgent(Agent):
    """
    Counter staff member.

    Continuously pops from the assigned counter queue, waits
    service_time steps, then marks the student as served and
    assigns them a seat.
    """

    def __init__(
        self,
        unique_id:    int,
        model:        "CafeteriaModel",
        counter_idx:  int,
        service_time: int = 10,
    ) -> None:
        super().__init__(unique_id, model)
        self.counter_idx  = counter_idx
        self.service_time = service_time
        self.current_customer: Optional[StudentAgent] = None
        self.remaining_time:   int = 0
        self.served_count:     int = 0

    def step(self) -> None:
        if self.current_customer is not None:
            self.remaining_time -= 1
            if self.remaining_time <= 0:
                self._complete_service()
        else:
            self._pick_next()

    def _pick_next(self) -> None:
        queue = self.model.counter_queues[self.counter_idx]
        if queue:
            student = queue.pop(0)
            self.current_customer = student
            prep_range = MENU_PREP[student.menu]
            self.remaining_time = random.randint(*prep_range)

    def _complete_service(self) -> None:
        student = self.current_customer
        if student and student.state == AgentState.QUEUING_FOOD:
            seat = self.model.claim_seat()
            if seat:
                student.seat_pos = seat
                student.state    = AgentState.FINDING_SEAT
                self.model.record_served(student)
            else:
                # No seats: make student wait a bit longer
                self.model.counter_queues[self.counter_idx].insert(0, student)
        self.current_customer = None
        self.served_count += 1

    def to_dict(self) -> dict:
        x, y = self.pos if self.pos else (-1, -1)
        return {
            "id":      self.unique_id,
            "x":       x,
            "y":       y,
            "state":   "serving" if self.current_customer else "idle",
            "counter": self.counter_idx,
        }
