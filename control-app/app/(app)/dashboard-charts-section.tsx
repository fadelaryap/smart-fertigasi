"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  IrrigationTimeline,
  MetricLineChart,
  DualLineChart,
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
    fetch("/api/dashboard-data?days=3")
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

// ─── Range Toggle ──────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { label: "1H", days: 1 },
  { label: "3H", days: 3 },
  { label: "7H", days: 7 },
];

function RangeToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="chart-range-toggle">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          className={value === opt.days ? "active" : ""}
          onClick={() => onChange(opt.days)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Hook to fetch chart data for a specific range
function useChartData(days: number) {
  const ctx = useContext(Ctx);
  const [overrideData, setOverrideData] = useState<DashboardData | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  useEffect(() => {
    // Default 3d uses context data — no extra fetch needed
    if (days === 3) {
      setOverrideData(null);
      return;
    }
    setOverrideLoading(true);
    fetch(`/api/dashboard-data?days=${days}`)
      .then((r) => r.json())
      .then((d) => { setOverrideData(d); setOverrideLoading(false); })
      .catch(() => setOverrideLoading(false));
  }, [days]);

  if (days === 3) {
    return { data: ctx.data, loading: ctx.loading };
  }
  return { data: overrideData, loading: overrideLoading || ctx.loading };
}

// ─── Individual Chart Slots ────────────────────────────────────────────────
export function TimelineSlot() {
  const [days, setDays] = useState(3);
  const [isVisible, setIsVisible] = useState(true);
  const { data, loading } = useChartData(days);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 6" }}>
      <div className="card-header-row">
        <div className="card-header">
          <div className="card-icon" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>📊</div>
          <div>
            <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              Timeline Penyiraman
              <button
                onClick={() => setIsVisible(!isVisible)}
                style={{
                  fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                  color: "var(--muted)", cursor: "pointer"
                }}
              >
                {isVisible ? "Sembunyikan" : "Tampilkan"}
              </button>
            </h3>
            <p className="card-subtitle">Jadwal vs aktual · {days} hari terakhir</p>
          </div>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </div>
      {isVisible && (
        <ChartShell loading={loading}>
          {data && <IrrigationTimeline bars={data.bars} rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} />}
        </ChartShell>
      )}
    </div>
  );
}

export function DurationChartSlot() {
  const [days, setDays] = useState(3);
  const { data, loading } = useChartData(days);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header-row">
        <div className="card-header">
          <div className="card-icon" style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)" }}>⏱️</div>
          <div>
            <h3>Jadwal Penyiraman</h3>
            <p className="card-subtitle">Durasi (menit) · {days}H</p>
          </div>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </div>
      <ChartShell loading={loading}>
        {data && <DualLineChart data={data.runDataPoints}
          rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} height={190} />}
      </ChartShell>
    </div>
  );
}

export function ET0ChartSlot() {
  const [days, setDays] = useState(3);
  const { data, loading } = useChartData(days);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header-row">
        <div className="card-header">
          <div className="card-icon" style={{ background: "linear-gradient(135deg, #06b6d4, #0ea5e9)" }}>🌡️</div>
          <div>
            <h3>ET0</h3>
            <p className="card-subtitle">Evapotranspirasi (mm/jam) · {days}H</p>
          </div>
        </div>
        <RangeToggle value={days} onChange={setDays} />
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
  const [days, setDays] = useState(3);
  const { data, loading } = useChartData(days);
  return (
    <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
      <div className="card-header-row">
        <div className="card-header">
          <div className="card-icon" style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>🌱</div>
          <div>
            <h3>Lengas Tanah</h3>
            <p className="card-subtitle">Soil moisture (%) · {days}H</p>
          </div>
        </div>
        <RangeToggle value={days} onChange={setDays} />
      </div>
      <ChartShell loading={loading}>
        {data && <MetricLineChart data={data.runDataPoints} metricKey="soilAvg"
          label="Lengas" color="#10b981" unit="%"
          rangeStart={data.rangeStart} rangeEnd={data.rangeEnd} height={190} />}
      </ChartShell>
    </div>
  );
}
