/**
 * StatsPanel – Real-time KPI dashboard.
 *
 * Displays:
 *  - M/M/c utilisation factor ρ (with stability warning when ρ ≥ 1)
 *  - Throughput time-series chart (Recharts)
 *  - Revenue, wait time, abandonment, seat utilisation
 */
import React from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, Clock, DollarSign, AlertTriangle } from "lucide-react";
import type { SimStats } from "../types";

interface StatCardProps {
  label: string;
  value: string;
  icon:  React.ReactNode;
  color: string;
  sub?:  string;
}

const StatCard: React.FC<StatCardProps> = ({ label, icon, value, color, sub }) => (
  <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700">
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={color}>{icon}</span>
    </div>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
  </div>
);

interface Props {
  stats: SimStats | null;
  step:  number;
}

export const StatsPanel: React.FC<Props> = ({ stats, step }) => {
  if (!stats) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        データ待機中…
      </div>
    );
  }

  const throughputData = stats.throughput_history.map((v, i) => ({
    t: i,
    thr: v,
  }));

  const rhoColor = stats.rho >= 1.0
    ? "text-red-400"
    : stats.rho >= 0.8
    ? "text-yellow-400"
    : "text-emerald-400";

  const abandonRate = stats.total_students > 0
    ? ((stats.total_abandoned / (stats.total_served + stats.total_abandoned)) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="space-y-4">
      {/* M/M/c Utilisation */}
      <div className={`rounded-xl p-3 border ${stats.rho >= 1 ? "border-red-500/50 bg-red-900/20" : "border-gray-700 bg-gray-800/60"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">M/M/c 利用率 ρ = λ/(c·μ)</p>
            <p className={`text-3xl font-bold ${rhoColor}`}>{stats.rho}</p>
          </div>
          {stats.rho >= 1 && (
            <div className="flex items-center gap-1 text-red-400 text-xs animate-pulse">
              <AlertTriangle size={14} />
              <span>過負荷</span>
            </div>
          )}
        </div>
        {/* Utilisation bar */}
        <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              stats.rho >= 1 ? "bg-red-500" : stats.rho >= 0.8 ? "bg-yellow-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(100, stats.rho * 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          ρ &lt; 1 で安定運用。ρ ≥ 1 だとキューが無限大に発散します（待ち行列理論）
        </p>
      </div>

      {/* Throughput chart */}
      <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700">
        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
          <TrendingUp size={11} /> スループット（提供数/step）
        </p>
        {throughputData.length > 1 ? (
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={throughputData}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "none", fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(2)}`, "thr"]}
              />
              <ReferenceLine y={0} stroke="#374151" />
              <Line
                type="monotone" dataKey="thr"
                stroke="#34d399" strokeWidth={2} dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-600 text-xs text-center py-4">データ蓄積中…</p>
        )}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="総収益"
          icon={<DollarSign size={13} />}
          value={`¥${stats.revenue.toLocaleString()}`}
          color="text-emerald-400"
        />
        <StatCard
          label="平均待ち時間"
          icon={<Clock size={13} />}
          value={`${stats.avg_wait}s`}
          color="text-blue-400"
          sub="steps"
        />
        <StatCard
          label="提供済み"
          icon={<TrendingUp size={13} />}
          value={`${stats.total_served}`}
          color="text-purple-400"
        />
        <StatCard
          label="離脱率"
          icon={<AlertTriangle size={13} />}
          value={`${abandonRate}%`}
          color={parseFloat(abandonRate) > 20 ? "text-red-400" : "text-orange-400"}
          sub={`${stats.total_abandoned}件`}
        />
      </div>

      {/* Seat utilisation bar */}
      <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">座席稼働率</span>
          <span className="text-indigo-400 font-bold">
            {(stats.seat_utilisation * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${stats.seat_utilisation * 100}%` }}
          />
        </div>
      </div>

      {/* Step counter */}
      <p className="text-xs text-gray-600 text-right font-mono">step: {step}</p>
    </div>
  );
};
