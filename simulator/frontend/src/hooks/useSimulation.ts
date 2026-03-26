/**
 * useSimulation
 * Manages the WebSocket connection to the FastAPI backend and exposes
 * the latest simulation state + control helpers to React components.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GridLayout, SimConfig, SimState, NodeType } from "../types";

const _API    = import.meta.env.VITE_API_URL ?? "http://localhost:8001";
const API_URL = _API;
const WS_URL  = _API.replace(/^http/, "ws") + "/ws";

interface UseSimulationReturn {
  layout:    GridLayout | null;
  state:     SimState   | null;
  connected: boolean;
  running:   boolean;
  play:      () => void;
  pause:     () => void;
  reset:     () => void;
  step:      (n?: number) => void;
  setSpeed:  (sps: number) => void;
  updateConfig: (cfg: Partial<SimConfig>) => void;
  updateLayout: (cells: NodeType[][]) => void;
}

export function useSimulation(): UseSimulationReturn {
  const [layout,    setLayout]    = useState<GridLayout | null>(null);
  const [state,     setState]     = useState<SimState   | null>(null);
  const [connected, setConnected] = useState(false);
  const [running,   setRunning]   = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket setup ──────────────────────────────────────────────────

  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen  = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retryTimer = setTimeout(connect, 2000);   // auto-reconnect
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data) as { type: string; data: unknown };
        if (msg.type === "layout") {
          setLayout(msg.data as GridLayout);
        } else if (msg.type === "state") {
          setState(msg.data as SimState);
        }
      };
    };

    connect();
    return () => {
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  // ── Control helpers ──────────────────────────────────────────────────

  const post = useCallback(async (path: string, body?: object) => {
    await fetch(`${API_URL}${path}`, {
      method:  "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body:    body ? JSON.stringify(body) : undefined,
    });
  }, []);

  const play = useCallback(() => {
    post("/control/play").then(() => setRunning(true));
  }, [post]);

  const pause = useCallback(() => {
    post("/control/pause").then(() => setRunning(false));
  }, [post]);

  const reset = useCallback(() => {
    setRunning(false);
    post("/reset").then(() => {
      // Re-fetch layout after rebuild
      fetch(`${API_URL}/layout`)
        .then((r) => r.json())
        .then(setLayout);
      setState(null);
    });
  }, [post]);

  const step = useCallback((n = 1) => {
    post("/step", { n });
    // Since post returns void, manually fetch state
    fetch(`${API_URL}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n }),
    })
      .then((r) => r.json())
      .then(setState);
  }, []);

  const setSpeed = useCallback((sps: number) => {
    post("/control/speed", { steps_per_second: sps });
  }, [post]);

  const updateConfig = useCallback((cfg: Partial<SimConfig>) => {
    if (!state) return;
    const merged: SimConfig = { ...state.config, ...cfg };
    post("/config", merged);
  }, [post, state]);

  const updateLayout = useCallback(async (cells: NodeType[][]) => {
    setRunning(false);
    const res = await fetch(`${API_URL}/layout/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells }),
    });
    if (res.ok) {
      const data = await res.json();
      setLayout(data.layout as GridLayout);
      setState(null);
    }
  }, []);

  return {
    layout, state, connected, running,
    play, pause, reset, step, setSpeed, updateConfig, updateLayout,
  };
}
