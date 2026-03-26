"""
Agent definitions for cafeteria MAS.

StudentAgent implements a Finite State Machine (FSM):

  ENTERING → BUYING_TICKET → FINDING_SEAT → WAITING_FOOD
           → PICKING_UP → EATING → RETURNING_TRAY → EXITING → (removed)

Flow:
  1. Enter the cafeteria
  2. Buy a ticket at the vending machine
  3. Find a seat and sit down
  4. Wait at the seat while staff prepares the food
  5. Walk to the counter to pick up the food
  6. Walk back to the seat and eat
  7. Return the tray
  8. Exit

StaffAgent processes the counter queue at a fixed service rate.
When food is ready, the student's ``food_ready`` flag is set.
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
    FINDING_SEAT   = "finding_seat"
    WAITING_FOOD   = "waiting_food"
    PICKING_UP     = "picking_up"
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
    food_ready : bool         – set True by StaffAgent when order is done
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

        # Food readiness – set by StaffAgent when the order is prepared
        self.food_ready: bool = False
        self.pickup_pos: Optional[Pos] = None   # counter position to pick up from

        # Abandonment: Poisson-process rate  λ = (1-patience) * base_rate
        self._abandon_rate: float = max(0.005, (1.0 - patience) * 0.03)

    # ------------------------------------------------------------------
    # Mesa hook
    # ------------------------------------------------------------------

    def step(self) -> None:
        dispatch = {
            AgentState.ENTERING:       self._entering,
            AgentState.BUYING_TICKET:  self._buying_ticket,
            AgentState.FINDING_SEAT:   self._finding_seat,
            AgentState.WAITING_FOOD:   self._waiting_food,
            AgentState.PICKING_UP:     self._picking_up,
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
        # Ticket machine processes queue → changes state via model

    def _finding_seat(self) -> None:
        """Walk to reserved seat, then start waiting for food."""
        if not self.path and self.seat_pos:
            self.path = self.model.find_path(self.pos, self.seat_pos)

        moved = self._move()
        if moved and not self.path:
            # Seated – now wait for food to be prepared
            self.state = AgentState.WAITING_FOOD

    def _waiting_food(self) -> None:
        """Sit at seat and wait for food_ready flag from staff."""
        self.wait_steps += 1
        if self._should_abandon():
            self._abandon("counter_queue")
            return
        if self.food_ready:
            # Food is ready! Go pick it up from the counter
            self.state = AgentState.PICKING_UP
            if self.pickup_pos:
                # Stand just in front of counter (1 cell to the left)
                pickup_dest = (max(1, self.pickup_pos[0] - 1), self.pickup_pos[1])
                self.path = self.model.find_path(self.pos, pickup_dest)

    def _picking_up(self) -> None:
        """Walk to counter, pick up food, then walk back to seat."""
        moved = self._move()
        if moved and not self.path:
            # Picked up food → record as served, walk back to seat
            self.model.record_served(self)
            self.state = AgentState.EATING
            self.action_timer = random.randint(*MENU_EAT[self.menu])
            # Walk back to seat
            if self.seat_pos:
                self.path = self.model.find_path(self.pos, self.seat_pos)

    def _eating(self) -> None:
        """Walk back to seat (if not there) and eat."""
        if self.path:
            self._move()
            return
        self.action_timer -= 1
        if self.action_timer <= 0:
            self.state = AgentState.RETURNING_TRAY
            if self.model.layout.return_positions:
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
            if self.model.layout.entry_positions:
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
        # Release seat if claimed
        if self.seat_pos:
            self.model.release_seat(self.seat_pos)
            self.seat_pos = None
        self.state = AgentState.EXITING
        if self.model.layout.entry_positions:
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
    service_time steps, then marks the student's food as ready.
    The student will then come pick it up.
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
        if student and student.state == AgentState.WAITING_FOOD:
            # Signal the student that food is ready
            student.food_ready = True
            # Tell student which counter to pick up from
            counter_positions = self.model.layout.counter_positions
            if self.counter_idx < len(counter_positions):
                student.pickup_pos = counter_positions[self.counter_idx]
            elif counter_positions:
                student.pickup_pos = counter_positions[0]
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
