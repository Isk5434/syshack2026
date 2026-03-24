# 学食混雑最適化シミュレーター

Multi-Agent Simulation × Queueing Theory × A* Pathfinding

## 起動手順

### バックエンド
```bash
cd simulator/backend
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

### フロントエンド
```bash
cd simulator/frontend
npm install
npm run dev
# → http://localhost:5174
```

## アーキテクチャ

```
simulator/
├── backend/
│   ├── main.py          # FastAPI + WebSocket ストリーミング
│   ├── model.py         # Mesa CafeteriaModel（M/M/c キュー）
│   ├── agents.py        # StudentAgent (FSM) / StaffAgent
│   ├── pathfinding.py   # A* + 密度ベース混雑コスト
│   ├── grid_layout.py   # 40×22 グリッド定義
│   └── requirements.txt
└── frontend/
    └── src/
        ├── App.tsx
        ├── types.ts
        ├── hooks/useSimulation.ts   # WebSocket hook
        └── components/
            ├── SimulationCanvas.tsx # Canvas レンダリング
            ├── ControlPanel.tsx     # What-if スライダー
            └── StatsPanel.tsx       # KPI ダッシュボード
```

## 技術的ハイライト

| 技術 | 実装 |
|------|------|
| **M/M/c 待ち行列理論** | ρ = λ/(c·μ) をリアルタイム表示。ρ≥1 で過負荷警告 |
| **A* + Greenshields速度モデル** | v(ρ) = v_max × (1−β·ρ) で密度に応じた経路選択 |
| **指数分布離脱確率** | P(abandon) = 1−exp(−λ) で忍耐度をモデル化 |
| **Poisson 来客プロセス** | 現実的な到着間隔を再現 |
| **WebSocket ストリーミング** | 60fps 相当の状態プッシュ |
