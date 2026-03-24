"""
A* pathfinding with dynamic congestion-based edge costs.

Speed model (Greenshields-inspired):
    v(ρ) = v_max * max(0.1, 1 - β * ρ)

where ρ = local agent density (agents per cell, normalised 0-1).
High density → slow movement → high edge cost → A* prefers less-crowded routes.

This is the key technical differentiator for the hackathon:
combining classical A* with continuum crowd-flow theory.
"""
from __future__ import annotations

import heapq
from typing import Dict, List, Optional, Set, Tuple

Pos = Tuple[int, int]


def _manhattan(a: Pos, b: Pos) -> float:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def _neighbors(pos: Pos, passable: Set[Pos]) -> List[Pos]:
    x, y = pos
    return [
        nb for nb in [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
        if nb in passable
    ]


def _reconstruct(came_from: Dict[Pos, Optional[Pos]], current: Pos) -> List[Pos]:
    path: List[Pos] = []
    while current is not None:
        path.append(current)
        current = came_from[current]  # type: ignore[assignment]
    path.reverse()
    return path


def astar(
    passable:  Set[Pos],
    start:     Pos,
    goal:      Pos,
    density:   Dict[Pos, float],
    v_max:     float = 1.0,
    beta:      float = 0.6,
) -> List[Pos]:
    """
    Return the lowest-cost path from *start* to *goal*.

    Parameters
    ----------
    passable : walkable cell set
    density  : normalised agent density per cell (0-1)
    beta     : sensitivity to congestion (higher → stronger avoidance)

    Returns empty list when no path exists.
    """
    open_heap: List[Tuple[float, Pos]] = []
    heapq.heappush(open_heap, (0.0, start))

    came_from: Dict[Pos, Optional[Pos]] = {start: None}
    g: Dict[Pos, float] = {start: 0.0}

    while open_heap:
        _, current = heapq.heappop(open_heap)

        if current == goal:
            return _reconstruct(came_from, current)

        for nb in _neighbors(current, passable):
            rho  = density.get(nb, 0.0)
            # Edge cost: inverse speed so denser areas cost more to traverse
            speed      = max(0.1, v_max * (1.0 - beta * rho))
            edge_cost  = 1.0 / speed

            tentative_g = g[current] + edge_cost

            if nb not in g or tentative_g < g[nb]:
                g[nb] = tentative_g
                f = tentative_g + _manhattan(nb, goal)
                heapq.heappush(open_heap, (f, nb))
                came_from[nb] = current

    return []   # unreachable


def compute_density(
    positions: List[Pos],
    grid_w:    int,
    grid_h:    int,
    radius:    int = 1,
) -> Dict[Pos, float]:
    """
    Compute local normalised density for each cell.
    Each agent contributes 1/max_local to its neighbourhood.
    """
    raw: Dict[Pos, int] = {}
    for pos in positions:
        px, py = pos
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                nb = (px + dx, py + dy)
                if 0 <= nb[0] < grid_w and 0 <= nb[1] < grid_h:
                    raw[nb] = raw.get(nb, 0) + 1

    if not raw:
        return {}

    max_val = max(raw.values())
    return {pos: count / max_val for pos, count in raw.items()}
