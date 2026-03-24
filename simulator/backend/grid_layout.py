"""
Grid layout definition for cafeteria simulation.
Coordinate system: Mesa (x=col from left, y=row from bottom).
"""
from __future__ import annotations
from enum import Enum
from typing import List, Set, Tuple

GRID_W = 40
GRID_H = 22


class NodeType(str, Enum):
    WALL   = "wall"
    FLOOR  = "floor"
    ENTRY  = "entry"
    TICKET = "ticket"
    COUNTER = "counter"
    SEAT   = "seat"
    RETURN = "return"


class GridLayout:
    """
    Immutable cafeteria floor plan.
    Rebuilding is required when n_ticket_machines or n_counters changes.
    """

    def __init__(self, n_ticket_machines: int = 3, n_counters: int = 4) -> None:
        self.W = GRID_W
        self.H = GRID_H
        self.n_ticket_machines = n_ticket_machines
        self.n_counters = n_counters

        self._grid: List[List[NodeType]] = self._build()

        self.entry_positions:   List[Tuple[int, int]] = []
        self.ticket_positions:  List[Tuple[int, int]] = []
        self.counter_positions: List[Tuple[int, int]] = []
        self.seat_positions:    List[Tuple[int, int]] = []
        self.return_positions:  List[Tuple[int, int]] = []
        self.passable:          Set[Tuple[int, int]]  = set()

        self._index()

    # ------------------------------------------------------------------
    # Internal builders
    # ------------------------------------------------------------------

    def _build(self) -> List[List[NodeType]]:
        # grid[y][x]  (y=0 = bottom row in Mesa convention)
        grid: List[List[NodeType]] = [
            [NodeType.FLOOR] * self.W for _ in range(self.H)
        ]

        # Border walls
        for x in range(self.W):
            grid[0][x] = NodeType.WALL
            grid[self.H - 1][x] = NodeType.WALL
        for y in range(self.H):
            grid[y][0] = NodeType.WALL
            grid[y][self.W - 1] = NodeType.WALL

        # Entry points (left wall openings, y = 8-13)
        for y in range(8, 14):
            grid[y][0] = NodeType.ENTRY

        # Ticket machines: x=5, spread vertically
        all_ticket_ys = [4, 7, 10, 13, 16]
        for y in all_ticket_ys[: self.n_ticket_machines]:
            grid[y][5] = NodeType.TICKET

        # Counters: x=16, spread vertically
        all_counter_ys = [3, 5, 7, 9, 11, 13, 15, 17]
        for y in all_counter_ys[: self.n_counters]:
            grid[y][16] = NodeType.COUNTER

        # Seats: right zone  x ∈ {21,24,27,30,33,36,38}, y ∈ {2,4,..,18}
        for seat_x in range(21, self.W - 1, 3):
            for seat_y in range(2, self.H - 2, 2):
                grid[seat_y][seat_x] = NodeType.SEAT

        # Tray return desk
        grid[2][8] = NodeType.RETURN

        return grid

    def _index(self) -> None:
        for y in range(self.H):
            for x in range(self.W):
                nt = self._grid[y][x]
                pos = (x, y)
                if nt != NodeType.WALL:
                    self.passable.add(pos)
                if nt == NodeType.ENTRY:
                    self.entry_positions.append(pos)
                elif nt == NodeType.TICKET:
                    self.ticket_positions.append(pos)
                elif nt == NodeType.COUNTER:
                    self.counter_positions.append(pos)
                elif nt == NodeType.SEAT:
                    self.seat_positions.append(pos)
                elif nt == NodeType.RETURN:
                    self.return_positions.append(pos)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def node_type(self, x: int, y: int) -> NodeType:
        return self._grid[y][x]

    def to_serializable(self) -> dict:
        """Serialise for API / frontend consumption."""
        return {
            "W": self.W,
            "H": self.H,
            "cells": [
                [cell.value for cell in row]
                for row in self._grid
            ],
        }
