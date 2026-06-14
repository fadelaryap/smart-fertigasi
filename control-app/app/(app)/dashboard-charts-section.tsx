"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  IrrigationTimeline,
  MetricLineChart,
  type ScheduleBar,
  type RunDataPoint,
} from "./dashboard-chart";

// ─── Data Context ──────────────────────────────────────────────────────────
interface DashboardData {
  bars: ScheduleBar[];
  runDataPoints: RunDataPoint[];
  rangeStart: string;
  rangeEnd: string;
}

const Ctx = createContext<{ data: DashboardData | null; loading: boolean }>({
  data: null,
  loading: true,
});

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard-data")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return <Ctx.Provider value={{ data, loading }}>{children}</Ctx.Provider>;
}

function ChartShell({ children, loading }: { children: ReactNode; loading: boolean }) {
  if (loading) {
    return (
      <div className="chart-loading">
        <span className="spinner" style={{ width: 18, height: 18 }}></span>
        <span>Memuat…</span>
      </div>
    );
  }
  return <>{children}</>;
}

// ─── Individual Chart Slots ────────────────────────────────────────────────
export function TimelineSlot() {
  const { data, loading } = useContext(Ctx);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 6" }}>
      <div className="card-header">
        <div className="card-icon" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>📊</div>
        <div>
          <h3>Jadwal vs Aktual Penyiraman</h3>
          <p className="card-subtitle">3 hari terakhir</p>
        </div>
      </div>
      <ChartShell loading={loading}>
        {data && <IrrigationTimeline bars={data.bars} rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} />}
      </ChartShell>
    </div>
  );
}

export function DurationChartSlot() {
  const { data, loading } = useContext(Ctx);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header">
        <div className="card-icon" style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)" }}>⏱️</div>
        <div>
          <h3>Durasi</h3>
          <p className="card-subtitle">Lama penyiraman (menit)</p>
        </div>
      </div>
      <ChartShell loading={loading}>
        {data && <MetricLineChart data={data.runDataPoints} metricKey="durationMinutes"
          label="Durasi" color="#8b5cf6" unit="mnt"
          rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} height={190} />}
      </ChartShell>
    </div>
  );
}

export function ET0ChartSlot() {
  const { data, loading } = useContext(Ctx);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header">
        <div className="card-icon" style={{ background: "linear-gradient(135deg, #06b6d4, #0ea5e9)" }}>🌡️</div>
        <div>
          <h3>ET0</h3>
          <p className="card-subtitle">Evapotranspirasi (mm/jam)</p>
        </div>
      </div>
      <ChartShell loading={loading}>
        {data && <MetricLineChart data={data.runDataPoints} metricKey="et0"
          label="ET0" color="#06b6d4" unit="mm/jam"
          rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} height={190} />}
      </ChartShell>
    </div>
  );
}

export function SoilChartSlot() {
  const { data, loading } = useContext(Ctx);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header">
        <div className="card-icon" style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>🌱</div>
        <div>
          <h3>Kelembapan Tanah</h3>
          <p className="card-subtitle">Soil moisture (%)</p>
        </div>
      </div>
      <ChartShell loading={loading}>
        {data && <MetricLineChart data={data.runDataPoints} metricKey="soilAvg"
          label="Soil Avg" color="#10b981" unit="%"
          rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} height={190} />}
      </ChartShell>
    </div>
  );
}
