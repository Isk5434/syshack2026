"""
FastAPI server for the cafeteria simulation.

Endpoints
---------
GET  /layout           – static grid layout (called once on frontend init)
GET  /state            – current simulation snapshot
POST /step             – advance N steps (default 1)
POST /config           – update parameters live (what-if analysis)
POST /reset            – rebuild model with current config
POST /layout/update    – apply custom grid layout
WS   /ws               – real-time WebSocket stream (pushes state each step)

RL endpoints
------------
POST /rl/train         – start PPO training in background
POST /rl/stop          – stop training
GET  /rl/status        – training progress + best layout
POST /rl/apply         – apply best RL layout to the simulation

Run:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
from typing import List, Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from model import CafeteriaModel

# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="Cafeteria Simulator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global simulation state
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG = dict(
    spawn_rate=0.8,
    n_staff=3,
    n_ticket_machines=3,
    staff_service_time=10,
)

model: CafeteriaModel = CafeteriaModel(**_DEFAULT_CONFIG)
_running: bool = False
_speed:   float = 2.0   # steps per second when streaming


class ConnectionManager:
    def __init__(self) -> None:
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.active.discard(ws)

    async def broadcast(self, data: str) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.active):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.discard(ws)


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConfigUpdate(BaseModel):
    spawn_rate:         float = Field(0.8,  ge=0.1, le=5.0)
    n_staff:            int   = Field(3,    ge=1,   le=10)
    n_ticket_machines:  int   = Field(3,    ge=1,   le=6)
    staff_service_time: int   = Field(10,   ge=2,   le=30)

class LayoutUpdate(BaseModel):
    cells: List[List[str]]

class StepRequest(BaseModel):
    n: int = Field(1, ge=1, le=100)

class SpeedRequest(BaseModel):
    steps_per_second: float = Field(2.0, ge=0.1, le=20.0)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/layout")
async def get_layout() -> dict:
    """Return the static grid layout (only needs to be fetched once)."""
    return model.layout.to_serializable()


@app.get("/state")
async def get_state() -> dict:
    return model.collect_state()


@app.post("/step")
async def advance(req: StepRequest) -> dict:
    """Manually advance the simulation by *n* steps."""
    for _ in range(req.n):
        model.step()
    return model.collect_state()


@app.post("/config")
async def update_config(cfg: ConfigUpdate) -> dict:
    """
    Live parameter update.
    Staff count and ticket machine count require a model rebuild
    (layout changes); other params are hot-swapped.
    """
    global model
    needs_rebuild = (
        cfg.n_staff           != model.n_staff or
        cfg.n_ticket_machines != model.n_ticket_machines
    )
    if needs_rebuild:
        model = CafeteriaModel(**cfg.model_dump())
    else:
        model.spawn_rate         = cfg.spawn_rate
        model.staff_service_time = cfg.staff_service_time
        # Update service time on existing staff
        for agent in model.schedule.agents:
            if hasattr(agent, "service_time"):
                agent.service_time = cfg.staff_service_time

    return {"ok": True, "rebuilt": needs_rebuild}


@app.post("/layout/update")
async def update_layout(req: LayoutUpdate) -> dict:
    """Apply a custom layout and rebuild the simulation model."""
    global model, _running
    _running = False
    from grid_layout import GridLayout
    new_layout = GridLayout.from_cells(req.cells)
    model = CafeteriaModel(
        spawn_rate=model.spawn_rate,
        n_staff=model.n_staff,
        n_ticket_machines=model.n_ticket_machines,
        staff_service_time=model.staff_service_time,
        custom_layout=new_layout,
    )
    # Broadcast new layout to all WebSocket clients
    payload = json.dumps({"type": "layout", "data": new_layout.to_serializable()})
    await manager.broadcast(payload)
    return {"ok": True, "layout": new_layout.to_serializable()}


@app.post("/reset")
async def reset_model() -> dict:
    global model, _running
    _running = False
    model = CafeteriaModel(**_DEFAULT_CONFIG)
    return {"ok": True}


@app.post("/control/play")
async def play() -> dict:
    global _running
    _running = True
    return {"running": _running}


@app.post("/control/pause")
async def pause() -> dict:
    global _running
    _running = False
    return {"running": _running}


@app.post("/control/speed")
async def set_speed(req: SpeedRequest) -> dict:
    global _speed
    _speed = req.steps_per_second
    return {"steps_per_second": _speed}


# ---------------------------------------------------------------------------
# WebSocket streaming
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    # Send layout + initial state immediately
    await ws.send_text(json.dumps({"type": "layout", "data": model.layout.to_serializable()}))
    await ws.send_text(json.dumps({"type": "state", "data": model.collect_state()}))
    try:
        while True:
            if _running:
                model.step()
                payload = json.dumps({"type": "state", "data": model.collect_state()})
                await manager.broadcast(payload)
            await asyncio.sleep(1.0 / max(0.1, _speed))
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ---------------------------------------------------------------------------
# RL endpoints
# ---------------------------------------------------------------------------

from train_rl import get_training_state, start_training, stop_training


class RLTrainRequest(BaseModel):
    total_timesteps: int = Field(5000, ge=100, le=100_000)
    sim_steps:       int = Field(100,  ge=20,  le=500)
    max_swaps:       int = Field(20,   ge=5,   le=100)


@app.post("/rl/train")
async def rl_train(req: RLTrainRequest) -> dict:
    """Kick off PPO training in a daemon thread."""
    config = {
        "spawn_rate":         model.spawn_rate,
        "n_staff":            model.n_staff,
        "n_ticket_machines":  model.n_ticket_machines,
        "staff_service_time": model.staff_service_time,
    }
    ok = start_training(
        total_timesteps=req.total_timesteps,
        sim_steps=req.sim_steps,
        max_swaps=req.max_swaps,
        config=config,
    )
    return {"started": ok}


@app.post("/rl/stop")
async def rl_stop() -> dict:
    stop_training()
    return {"ok": True}


@app.get("/rl/status")
async def rl_status() -> dict:
    return get_training_state()


@app.post("/rl/apply")
async def rl_apply() -> dict:
    """Apply the best layout discovered by RL to the live simulation."""
    global model, _running
    state = get_training_state()
    best = state.get("best_layout")
    if not best:
        return {"ok": False, "error": "No optimised layout available yet"}

    _running = False
    from grid_layout import GridLayout
    new_layout = GridLayout.from_cells(best)
    model = CafeteriaModel(
        spawn_rate=model.spawn_rate,
        n_staff=model.n_staff,
        n_ticket_machines=model.n_ticket_machines,
        staff_service_time=model.staff_service_time,
        custom_layout=new_layout,
    )
    payload = json.dumps({"type": "layout", "data": new_layout.to_serializable()})
    await manager.broadcast(payload)
    return {"ok": True, "layout": new_layout.to_serializable()}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
