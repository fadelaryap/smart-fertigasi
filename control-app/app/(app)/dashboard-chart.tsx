"use client";

import { useEffect, useRef, useState } from "react";

function useChartDimensions(ref: React.RefObject<HTMLDivElement | null>, defaultHeight: number) {
  const [dims, setDims] = useState({ w: 600, h: defaultHeight });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return dims;
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface ScheduleBar {
  date: string;
  scheduledOn: string;
  scheduledOff: string;
  actualOn: string | null;
  actualOff: string | null;
}

export interface RunDataPoint {
  date: string;
  startedAtIso: string;
  durationMinutes: number;
  actualDurationMinutes: number;
  scheduledDurationMinutes: number;
  et0: number | null;
  soilAvg: number | null;
  status: string;
}

// ─── Timeline Chart (Scheduled vs Actual) ──────────────────────────────────
export function IrrigationTimeline({
  bars,
  rangeStart,
  rangeEnd,
}: {
  bars: ScheduleBar[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  if (bars.length === 0) {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-icon">📊</span>
        <span>Belum ada data penyiraman 3 hari terakhir</span>
      </div>
    );
  }

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  // Fixed 3-day: group bars by date, get unique dates in the range
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  // Convert to WIB for day labels
  while (cursor <= end) {
    const wib = new Date(cursor.getTime() + 7 * 60 * 60 * 1000);
    days.push(wib.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  // Make sure we always have today's WIB date
  const todayWib = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!days.includes(todayWib)) days.push(todayWib);

  // Find time range across all bars
  const allTimes: number[] = [];
  bars.forEach((b) => {
    allTimes.push(toMin(b.scheduledOn), toMin(b.scheduledOff));
    if (b.actualOn) allTimes.push(toMin(b.actualOn));
    if (b.actualOff) allTimes.push(toMin(b.actualOff));
  });
  const minTime = Math.max(0, Math.min(...allTimes) - 60);
  const maxTime = Math.min(1440, Math.max(...allTimes) + 60);
  const timeRange = maxTime - minTime || 120;

  const barHeight = 36;
  const gap = 6;
  const labelWidth = 72;
  const chartWidth = 500;
  const svgHeight = days.length * (barHeight + gap) + 44;
  const xScale = (min: number) => labelWidth + ((min - minTime) / timeRange) * chartWidth;

  const ticks: number[] = [];
  const tickStep = timeRange > 720 ? 180 : timeRange > 360 ? 120 : timeRange > 180 ? 60 : 30;
  for (let t = Math.ceil(minTime / tickStep) * tickStep; t <= maxTime; t += tickStep) {
    ticks.push(t);
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="timeline-container" ref={containerRef} onMouseMove={handleMouseMove}>
      <svg
        width="100%"
        viewBox={`0 0 ${labelWidth + chartWidth + 20} ${svgHeight}`}
        className="timeline-svg"
      >
        {/* Grid lines */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xScale(t)} y1={12} x2={xScale(t)} y2={svgHeight - 20}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <text x={xScale(t)} y={svgHeight - 4} fill="var(--muted)" fontSize="10"
              textAnchor="middle" fontFamily="inherit">
              {`${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="schedGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>

        {days.map((day, di) => {
          const y = di * (barHeight + gap) + 16;
          const dayBars = bars.filter((b) => b.date === day);
          const isHoveredDay = hoveredIdx !== null && bars[hoveredIdx]?.date === day;

          return (
            <g key={day}>
              {/* Day label */}
              <text x={4} y={y + barHeight / 2 + 4} fill={dayBars.length > 0 ? "var(--text)" : "var(--muted)"}
                fontSize="11" fontFamily="inherit" fontWeight={isHoveredDay ? "700" : "500"}
                opacity={dayBars.length > 0 ? 1 : 0.5}>
                {day.slice(5)}
              </text>

              {/* Row background for empty days */}
              {dayBars.length === 0 && (
                <rect x={labelWidth} y={y} width={chartWidth} height={barHeight} rx={6}
                  fill="var(--text)" opacity="0.015" />
              )}

              {/* Bars for this day */}
              {dayBars.map((b, bi) => {
                const globalIdx = bars.indexOf(b);
                const isHovered = hoveredIdx === globalIdx;
                const actualX1 = b.actualOn ? xScale(toMin(b.actualOn)) : null;
                const actualX2 = b.actualOff ? xScale(toMin(b.actualOff)) : null;
                const schedX1 = xScale(toMin(b.scheduledOn));
                const schedX2 = xScale(toMin(b.scheduledOff));

                return (
                  <g key={bi}
                    onMouseEnter={() => setHoveredIdx(globalIdx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    style={{ cursor: "pointer" }}>
                    {isHovered && (
                      <rect x={labelWidth} y={y - 1} width={chartWidth} height={barHeight + 2}
                        rx={6} fill="var(--text)" opacity="0.04" />
                    )}
                    {actualX1 != null && actualX2 != null && (
                      <rect x={actualX1} y={y + 2} width={Math.max(actualX2 - actualX1, 4)}
                        height={barHeight - 4} rx={6} fill="var(--accent-2)"
                        opacity={isHovered ? 0.35 : 0.18} className="timeline-bar-actual" />
                    )}
                    <rect x={schedX1} y={y + 7} width={Math.max(schedX2 - schedX1, 4)}
                      height={barHeight - 14} rx={5} fill="url(#schedGrad)"
                      opacity={isHovered ? 1 : 0.85} className="timeline-bar-sched" />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Floating tooltip */}
      {hoveredIdx !== null && bars[hoveredIdx] && (
        <div className="chart-tooltip" style={{ left: mousePos.x + 12, top: mousePos.y - 10 }}>
          <div className="tt-title">{bars[hoveredIdx].date}</div>
          <div className="tt-row">
            <span className="tt-dot" style={{ background: "#f59e0b" }}></span>
            Jadwal: {bars[hoveredIdx].scheduledOn} – {bars[hoveredIdx].scheduledOff}
          </div>
          {bars[hoveredIdx].actualOn && (
            <div className="tt-row">
              <span className="tt-dot" style={{ background: "var(--accent-2)", opacity: 0.5 }}></span>
              Aktual: {bars[hoveredIdx].actualOn} – {bars[hoveredIdx].actualOff || "?"}
            </div>
          )}
        </div>
      )}

      <div className="timeline-legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "linear-gradient(90deg, #f59e0b, #f97316)" }}></span>
          Jadwal
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "var(--accent-2)", opacity: 0.4 }}></span>
          Aktual
        </span>
        <span className="legend-item muted" style={{ marginLeft: "auto", fontSize: 10 }}>
          3 hari terakhir · baris kosong = tidak ada penyiraman
        </span>
      </div>
    </div>
  );
}

// ─── Single Metric Line Chart (fixed 3-day x-axis + tooltips) ──────────────
export function MetricLineChart({
  data,
  metricKey,
  label,
  color,
  unit,
  rangeStart,
  rangeEnd,
  height = 200,
}: {
  data: RunDataPoint[];
  metricKey: "durationMinutes" | "et0" | "soilAvg";
  label: string;
  color: string;
  unit: string;
  rangeStart: string;
  rangeEnd: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dims = useChartDimensions(containerRef, height);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const padding = { top: 20, right: 16, bottom: 54, left: 48 };
  const w = dims.w;
  const h = dims.h;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Fixed 3-day range
  const tStart = new Date(rangeStart).getTime();
  const tEnd = new Date(rangeEnd).getTime();
  const tRange = tEnd - tStart || 1;

  // Filter data points that have this metric
  const validPoints = data
    .map((d, i) => {
      const v = d[metricKey];
      if (v == null) return null;
      const t = new Date(d.startedAtIso).getTime();
      return { idx: i, t, value: v as number, data: d };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  // Y range
  const values = validPoints.map((p) => p.value);
  const yMin = values.length ? Math.min(...values) : 0;
  const yMax = values.length ? Math.max(...values) : 1;
  const yRange = yMax - yMin || 1;
  const yPad = yRange * 0.1;

  const xOf = (t: number) => padding.left + ((t - tStart) / tRange) * plotW;
  const yOf = (v: number) =>
    padding.top + plotH - ((v - (yMin - yPad)) / (yRange + yPad * 2)) * plotH;

  const points = validPoints.map((p) => ({ x: xOf(p.t), y: yOf(p.value), ...p }));

  // X-axis ticks: hourly grid lines, labels every 6h
  const xTicks = buildXTicks(tStart, tEnd, xOf);

  // Y ticks
  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    (yMin - yPad) + ((yRange + yPad * 2) * i) / yTicks
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hoveredPoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="metric-chart-container" onMouseMove={handleMouseMove} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: "250px" }}>
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="metric-chart-svg">
          {/* Y grid + labels */}
          {yTickVals.map((val, i) => {
            const y = yOf(val);
            return (
              <g key={i}>
                <line x1={padding.left} y1={y} x2={w - padding.right} y2={y}
                  stroke="var(--border)" strokeWidth="1" opacity="0.35" />
                <text x={padding.left - 6} y={y + 4} fill="var(--muted)" fontSize="10"
                  textAnchor="end" fontFamily="inherit">
                  {val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* X-axis: hourly grid + labeled ticks */}
          {xTicks.map((tk, i) => (
            <g key={i}>
              <line x1={tk.x} y1={padding.top} x2={tk.x} y2={padding.top + plotH}
                stroke="var(--border)"
                strokeWidth={tk.type === "midnight" ? "1.5" : "1"}
                strokeDasharray={tk.type === "midnight" ? "0" : tk.type === "major" ? "4 4" : "2 4"}
                opacity={tk.type === "midnight" ? 0.45 : tk.type === "major" ? 0.25 : 0.1} />
              {tk.dateLine && (
                <text x={tk.x} y={h - 18} fill="var(--muted)" fontSize="9"
                  textAnchor="middle" fontFamily="inherit"
                  fontWeight={tk.type === "midnight" ? "700" : "400"}>
                  {tk.dateLine}
                </text>
              )}
              {tk.timeLine && (
                <text x={tk.x} y={h - 6} fill="var(--muted)" fontSize="9"
                  textAnchor="middle" fontFamily="inherit"
                  fontWeight={tk.type === "midnight" ? "700" : "400"}>
                  {tk.timeLine}
                </text>
              )}
            </g>
          ))}

          {/* Area fill + line */}
          {points.length >= 2 && (() => {
            const pathD = buildSmoothPath(points);
            const fillPath = `${pathD} L ${points[points.length - 1].x},${padding.top + plotH} L ${points[0].x},${padding.top + plotH} Z`;
            return (
              <g>
                <defs>
                  <linearGradient id={`fill-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={fillPath} fill={`url(#fill-${metricKey})`} />
                <path d={pathD} fill="none" stroke={color} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })()}

          {/* Data points */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 6 : 3.5}
              fill={color} stroke="var(--panel-solid)" strokeWidth="2"
              onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "pointer", transition: "r 0.15s ease" }} />
          ))}

          {/* Hover crosshair */}
          {hoveredPoint && (
            <g>
              <line x1={hoveredPoint.x} y1={padding.top} x2={hoveredPoint.x}
                y2={padding.top + plotH} stroke={color} strokeWidth="1" opacity="0.3"
                strokeDasharray="3 3" />
              <line x1={padding.left} y1={hoveredPoint.y} x2={w - padding.right}
                y2={hoveredPoint.y} stroke={color} strokeWidth="1" opacity="0.2"
                strokeDasharray="3 3" />
            </g>
          )}

          {/* No data indicator */}
          {points.length === 0 && (
            <text x={w / 2} y={h / 2} fill="var(--muted)" fontSize="13"
              textAnchor="middle" fontFamily="inherit">
              Tidak ada data {label.toLowerCase()}
            </text>
          )}
        </svg>

        {/* Tooltip */}
        {hoveredPoint && (
          <div className="chart-tooltip" style={{ left: mousePos.x + 12, top: mousePos.y - 10 }}>
            <div className="tt-title">{hoveredPoint.data.date}</div>
            <div className="tt-row">
              <span className="tt-dot" style={{ background: color }}></span>
              {label}: <strong>{hoveredPoint.value >= 10 ? hoveredPoint.value.toFixed(1) : hoveredPoint.value.toFixed(3)}</strong> {unit}
            </div>
            <div className="tt-row muted" style={{ fontSize: 10 }}>
              Status: {hoveredPoint.data.status}
            </div>
          </div>
        )}
      </div>

      <div className="chart-legend" style={{ marginTop: 8 }}>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: color }}></span>
          {label} ({unit})
        </span>
        <span className="legend-item muted" style={{ marginLeft: "auto", fontSize: 10 }}>
          {points.length} data point
        </span>
      </div>
    </div>
  );
}

// ─── X-axis tick builder (hourly grid, labels every 6h) ───────────────────
interface XTick { x: number; dateLine: string | null; timeLine: string | null; type: "midnight" | "major" | "minor" }

function buildXTicks(
  tStart: number, tEnd: number,
  xOf: (t: number) => number,
): XTick[] {
  const ticks: XTick[] = [];
  // Find first WIB hour at or before tStart
  const WIB_OFF = 7 * 3600000;
  const startHour = new Date(tStart);
  startHour.setMinutes(0, 0, 0);
  // Walk back to previous hour
  while (startHour.getTime() > tStart - 3600000) startHour.setTime(startHour.getTime() - 3600000);

  for (let t = startHour.getTime(); t <= tEnd; t += 3600000) {
    if (t < tStart) continue;
    const wib = new Date(t + WIB_OFF);
    const hour = wib.getUTCHours();
    const dd = wib.getUTCDate().toString().padStart(2, "0");
    const mm = (wib.getUTCMonth() + 1).toString().padStart(2, "0");
    const hh = hour.toString().padStart(2, "0");

    if (hour === 0) {
      ticks.push({ x: xOf(t), dateLine: `${dd}/${mm}`, timeLine: "00:00", type: "midnight" });
    } else if (hour % 6 === 0) {
      ticks.push({ x: xOf(t), dateLine: `${dd}/${mm}`, timeLine: `${hh}:00`, type: "major" });
    } else {
      ticks.push({ x: xOf(t), dateLine: null, timeLine: null, type: "minor" });
    }
  }
  return ticks;
}

// ─── Smooth path builder (Catmull-Rom → Bezier) ───────────────────────────
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function buildMountainPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x},${points[i].y}`;
  }
  return d;
}

// ─── Dual Line Chart (Jadwal vs Aktual Duration) ───────────────────────────
export function DualLineChart({
  data,
  rangeStart,
  rangeEnd,
  height = 200,
}: {
  data: RunDataPoint[];
  rangeStart: string;
  rangeEnd: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dims = useChartDimensions(containerRef, height);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const padding = { top: 20, right: 16, bottom: 54, left: 48 };
  const w = dims.w;
  const h = dims.h;
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  // Fixed 3-day range
  const tStart = new Date(rangeStart).getTime();
  const tEnd = new Date(rangeEnd).getTime();
  const tRange = tEnd - tStart || 1;

  // Both series share the same x positions (each run)
  const validPoints = data
    .filter((d) => d.startedAtIso)
    .map((d, i) => ({
      idx: i,
      t: new Date(d.startedAtIso).getTime(),
      scheduled: d.scheduledDurationMinutes,
      actual: d.actualDurationMinutes,
      data: d,
    }))
    .sort((a,b) => a.t - b.t);

  // Y range across both series
  const allVals = validPoints.flatMap((p) => [p.scheduled, p.actual]);
  const yMin = 0;
  const yMax = allVals.length ? Math.max(...allVals) : 1;
  const yRange = yMax - yMin || 1;
  const yPad = yRange * 0.15;

  const xOf = (t: number) => padding.left + ((t - tStart) / tRange) * plotW;
  const yOf = (v: number) =>
    padding.top + plotH - ((v - (yMin - yPad)) / (yRange + yPad * 2)) * plotH;

  const schedLinePoints: {x: number, y: number}[] = [];
  const actualLinePoints: {x: number, y: number}[] = [];
  
  schedLinePoints.push({ x: xOf(tStart), y: yOf(0) });
  actualLinePoints.push({ x: xOf(tStart), y: yOf(0) });

  validPoints.forEach(p => {
    const tS = p.t;
    const durS = p.scheduled;
    const tPeakS = tS + (durS * 60000) / 2;
    const tEndS = tS + durS * 60000;

    schedLinePoints.push({ x: xOf(tS), y: yOf(0) });
    schedLinePoints.push({ x: xOf(tPeakS), y: yOf(durS) });
    schedLinePoints.push({ x: xOf(tEndS), y: yOf(0) });

    const durA = p.actual;
    const tPeakA = tS + (durA * 60000) / 2;
    const tEndA = tS + durA * 60000;

    actualLinePoints.push({ x: xOf(tS), y: yOf(0) });
    actualLinePoints.push({ x: xOf(tPeakA), y: yOf(durA) });
    actualLinePoints.push({ x: xOf(tEndA), y: yOf(0) });
  });

  schedLinePoints.push({ x: xOf(tEnd), y: yOf(0) });
  actualLinePoints.push({ x: xOf(tEnd), y: yOf(0) });

  const schedPoints = validPoints.map((p) => ({ x: xOf(p.t + (p.scheduled * 60000) / 2), y: yOf(p.scheduled), ...p }));
  const actualPoints = validPoints.map((p) => ({ x: xOf(p.t + (p.actual * 60000) / 2), y: yOf(p.actual), ...p }));

  // X-axis ticks: hourly grid
  const xTicks = buildXTicks(tStart, tEnd, xOf);

  // Y ticks
  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    (yMin - yPad) + ((yRange + yPad * 2) * i) / yTicks
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const schedColor = "#f59e0b";
  const actualColor = "#8b5cf6";

  return (
    <div className="metric-chart-container" onMouseMove={handleMouseMove} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="metric-chart-svg">
          {/* Y grid + labels */}
          {yTickVals.map((val, i) => {
            const y = yOf(val);
            return (
              <g key={i}>
                <line x1={padding.left} y1={y} x2={w - padding.right} y2={y}
                  stroke="var(--border)" strokeWidth="1" opacity="0.35" />
                <text x={padding.left - 6} y={y + 4} fill="var(--muted)" fontSize="10"
                  textAnchor="end" fontFamily="inherit">
                  {val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* X-axis: hourly grid + labeled ticks */}
          {xTicks.map((tk, i) => (
            <g key={i}>
              <line x1={tk.x} y1={padding.top} x2={tk.x} y2={padding.top + plotH}
                stroke="var(--border)"
                strokeWidth={tk.type === "midnight" ? "1.5" : "1"}
                strokeDasharray={tk.type === "midnight" ? "0" : tk.type === "major" ? "4 4" : "2 4"}
                opacity={tk.type === "midnight" ? 0.45 : tk.type === "major" ? 0.25 : 0.1} />
              {tk.dateLine && (
                <text x={tk.x} y={h - 18} fill="var(--muted)" fontSize="9"
                  textAnchor="middle" fontFamily="inherit"
                  fontWeight={tk.type === "midnight" ? "700" : "400"}>
                  {tk.dateLine}
                </text>
              )}
              {tk.timeLine && (
                <text x={tk.x} y={h - 6} fill="var(--muted)" fontSize="9"
                  textAnchor="middle" fontFamily="inherit"
                  fontWeight={tk.type === "midnight" ? "700" : "400"}>
                  {tk.timeLine}
                </text>
              )}
            </g>
          ))}

          {/* Scheduled duration: area + line */}
          {schedLinePoints.length >= 2 && (() => {
            const pathD = buildMountainPath(schedLinePoints);
            const fillPath = `${pathD} L ${schedLinePoints[schedLinePoints.length - 1].x},${padding.top + plotH} L ${schedLinePoints[0].x},${padding.top + plotH} Z`;
            return (
              <g>
                <defs>
                  <linearGradient id="fill-sched-dur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={schedColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={schedColor} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={fillPath} fill="url(#fill-sched-dur)" />
                <path d={pathD} fill="none" stroke={schedColor} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
              </g>
            );
          })()}

          {/* Actual duration: area + line */}
          {actualLinePoints.length >= 2 && (() => {
            const pathD = buildMountainPath(actualLinePoints);
            const fillPath = `${pathD} L ${actualLinePoints[actualLinePoints.length - 1].x},${padding.top + plotH} L ${actualLinePoints[0].x},${padding.top + plotH} Z`;
            return (
              <g>
                <defs>
                  <linearGradient id="fill-actual-dur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={actualColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={actualColor} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={fillPath} fill="url(#fill-actual-dur)" />
                <path d={pathD} fill="none" stroke={actualColor} strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })()}

          {/* Data points — scheduled */}
          {schedPoints.map((p, i) => (
            <circle key={`s${i}`} cx={p.x} cy={p.y} r={hoveredIdx === i ? 6 : 3.5}
              fill={schedColor} stroke="var(--panel-solid)" strokeWidth="2"
              onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "pointer", transition: "r 0.15s ease" }} />
          ))}
          {/* Data points — actual */}
          {actualPoints.map((p, i) => (
            <circle key={`a${i}`} cx={p.x} cy={p.y} r={hoveredIdx === i ? 6 : 3.5}
              fill={actualColor} stroke="var(--panel-solid)" strokeWidth="2"
              onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "pointer", transition: "r 0.15s ease" }} />
          ))}

          {/* Hover crosshair */}
          {hoveredIdx !== null && schedPoints[hoveredIdx] && (
            <g>
              <line x1={schedPoints[hoveredIdx].x} y1={padding.top}
                x2={schedPoints[hoveredIdx].x} y2={padding.top + plotH}
                stroke="var(--muted)" strokeWidth="1" opacity="0.3" strokeDasharray="3 3" />
            </g>
          )}

          {/* No data */}
          {validPoints.length === 0 && (
            <text x={w / 2} y={h / 2} fill="var(--muted)" fontSize="13"
              textAnchor="middle" fontFamily="inherit">
              Tidak ada data durasi dalam 3 hari
            </text>
          )}
        </svg>

        {/* Tooltip */}
        {hoveredIdx !== null && validPoints[hoveredIdx] && (
          <div className="chart-tooltip" style={{ left: mousePos.x + 12, top: mousePos.y - 10 }}>
            <div className="tt-title">{validPoints[hoveredIdx].data.date}</div>
            <div className="tt-row">
              <span className="tt-dot" style={{ background: schedColor }}></span>
              Jadwal: <strong>{validPoints[hoveredIdx].scheduled.toFixed(1)}</strong> mnt
            </div>
            <div className="tt-row">
              <span className="tt-dot" style={{ background: actualColor }}></span>
              Aktual: <strong>{validPoints[hoveredIdx].actual.toFixed(1)}</strong> mnt
            </div>
            <div className="tt-row muted" style={{ fontSize: 10 }}>
              Status: {validPoints[hoveredIdx].data.status}
            </div>
          </div>
        )}
      </div>

      <div className="chart-legend" style={{ marginTop: 8 }}>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: schedColor }}></span>
          Jadwal (mnt)
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: actualColor }}></span>
          Aktual (mnt)
        </span>
        <span className="legend-item muted" style={{ marginLeft: "auto", fontSize: 10 }}>
          {validPoints.length} data point
        </span>
      </div>
    </div>
  );
}

// ─── Live Clock ────────────────────────────────────────────────────────────
export function LiveClock() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })
      );
      setDate(
        now.toLocaleDateString("id-ID", {
          timeZone: "Asia/Jakarta",
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="live-clock">
      <div className="clock-time">{time || "--:--:--"}</div>
      <div className="clock-date">{date || "..."}</div>
      <div className="clock-tz">WIB (UTC+7)</div>
    </div>
  );
}
