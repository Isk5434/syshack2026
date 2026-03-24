"""
FastAPI server for the cafeteria simulation.

Endpoints
---------
GET  /layout        – static grid layout (called once on frontend init)
GET  /state         – current simulation snapshot
POST /step          – advance N steps (default 1)
POST /config        – update parameters live (what-if analysis)
POST /reset         – rebuild model with current config
WS   /ws            – real-time WebSocket stream (pushes state each step)

Run:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
from typing import Set

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
    # Send layout immediately
    await ws.send_text(json.dumps({"type": "layout", "data": model.layout.to_serializable()}))
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
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
