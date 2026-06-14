import { getDb, isSystemEnabled } from "@/lib/db";
import { isDryRun } from "@/lib/ewelink";
import { toWIB, getNextSchedule } from "@/lib/time";
import { runNowAction, stopRunAction, toggleSystemAction } from "./actions";
import { SubmitButton } from "../submit-button";
import { LiveClock } from "./dashboard-chart";
import {
  DashboardDataProvider,
  DurationChartSlot,
  ET0ChartSlot,
  SoilChartSlot,
  TimelineSlot,
} from "./dashboard-charts-section";

export const dynamic = "force-dynamic";

interface ChannelRow {
  id: number;
  run_id: number | null;
  device_id: string;
  channel: number;
  role: string;
  state: string;
  on_at: string | null;
  expected_off_at: string | null;
  verified: number;
}
interface RunRow {
  id: number;
  triggered_by: string;
  started_at: string | null;
  duration_minutes: number | null;
  status: string;
  et0: number | null;
  soil_avg: number | null;
  finished_at: string | null;
}

export default function Dashboard() {
  const db = getDb();
  const active = db
    .prepare("SELECT * FROM channel_state WHERE state='on' ORDER BY run_id, role")
    .all() as ChannelRow[];
  const runs = db
    .prepare("SELECT * FROM irrigation_runs ORDER BY id DESC LIMIT 10")
    .all() as RunRow[];
  const runningRunIds = [...new Set(active.map((c) => c.run_id))].filter(
    (x): x is number => x != null
  );
  const enabled = isSystemEnabled();
  const lastRun = runs[0];
  const lastEvent = db
    .prepare("SELECT ts, level, event FROM event_log ORDER BY id DESC LIMIT 1")
    .get() as { ts: string; level: string; event: string } | undefined;

  // Stats
  const totalRuns = (db.prepare("SELECT COUNT(*) as cnt FROM irrigation_runs").get() as { cnt: number }).cnt;
  const completedRuns = (db.prepare("SELECT COUNT(*) as cnt FROM irrigation_runs WHERE status='completed'").get() as { cnt: number }).cnt;
  const failedRuns = (db.prepare("SELECT COUNT(*) as cnt FROM irrigation_runs WHERE status='failed'").get() as { cnt: number }).cnt;
  const avgDuration = (db.prepare("SELECT AVG(duration_minutes) as avg FROM irrigation_runs WHERE duration_minutes IS NOT NULL").get() as { avg: number | null }).avg;

  // Schedules
  const enabledSchedules = db
    .prepare("SELECT time FROM schedules WHERE enabled = 1 ORDER BY time")
    .all() as { time: string }[];
  const nextSched = getNextSchedule(enabledSchedules.map((s) => s.time));
  const totalSchedules = enabledSchedules.length;

  // Active devices
  const activeDevices = (db.prepare("SELECT COUNT(*) as cnt FROM device_config WHERE enabled=1").get() as { cnt: number }).cnt;

  return (
    <>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div className="dash-header-new">
        <div className="dash-header-left">
          <h1>Dashboard</h1>
          <div className="dash-badges">
            <span className={`badge-pill ${enabled ? "badge-active" : "badge-inactive"}`}>
              <span className="badge-dot"></span>
              {enabled ? "SISTEM AKTIF" : "SISTEM NONAKTIF"}
            </span>
            <span className={`badge-pill ${isDryRun() ? "badge-warn" : "badge-live"}`}>
              {isDryRun() ? "DRY-RUN" : "LIVE"}
            </span>
          </div>
        </div>
        <div className="dash-header-right">
          <form action={toggleSystemAction}>
            <SubmitButton
              className={enabled ? "danger" : ""}
              pendingText={enabled ? "Menonaktifkan…" : "Mengaktifkan…"}
            >
              {enabled ? "■ Nonaktifkan" : "▶ Aktifkan"}
            </SubmitButton>
          </form>
          <form action={runNowAction}>
            <SubmitButton disabled={!enabled} pendingText="Menjalankan…">
              ▶ Run now
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* ─── Grid: 6 columns ───────────────────────────────────────────── */}
      {/* Layout:
           Row 1: [stat×6]
           Row 2: [Jadwal 2col][Clock 1col][Device 1col] | [Chart Durasi 2col]
           Row 3: [Status Terakhir 2col][Channel Aktif 2col] | [Chart ET0 2col]
           Row 4: [Timeline 4col] | [Chart Soil 2col]
           Row 5: [Riwayat table 6col]
      */}
      <DashboardDataProvider>
        <div className="dash-grid">
          {/* ── Row 1: Stat cards ─────────────────────────────────────── */}
          <div className="dash-card card-sm glass-card stat-card stat-green">
            <div className="stat-icon">🚿</div>
            <div className="stat-body">
              <div className="stat-value">{totalRuns}</div>
              <div className="stat-label">Total Run</div>
            </div>
          </div>

          <div className="dash-card card-sm glass-card stat-card stat-blue">
            <div className="stat-icon">✅</div>
            <div className="stat-body">
              <div className="stat-value">{completedRuns}</div>
              <div className="stat-label">Selesai</div>
            </div>
          </div>

          <div className="dash-card card-sm glass-card stat-card stat-red">
            <div className="stat-icon">❌</div>
            <div className="stat-body">
              <div className="stat-value">{failedRuns}</div>
              <div className="stat-label">Gagal</div>
            </div>
          </div>

          <div className="dash-card card-sm glass-card stat-card stat-purple">
            <div className="stat-icon">⏱️</div>
            <div className="stat-body">
              <div className="stat-value">{avgDuration != null ? avgDuration.toFixed(1) : "—"}</div>
              <div className="stat-label">Rata-rata (mnt)</div>
            </div>
          </div>

          <div className="dash-card card-sm glass-card stat-card stat-cyan">
            <div className="stat-icon">📡</div>
            <div className="stat-body">
              <div className="stat-value">{activeDevices}</div>
              <div className="stat-label">Device Aktif</div>
            </div>
          </div>

          <div className="dash-card card-sm glass-card clock-card">
            <LiveClock />
          </div>

          {/* ── Row 2: Jadwal (2col) + Status (2col) | Durasi chart (2col) */}
          <div className={`dash-card glass-card next-sched-card${enabled ? "" : " disabled"}`} style={{ gridColumn: "span 2" }}>
            <div className="card-header">
              <div className="card-icon" style={{ background: "linear-gradient(135deg, #3fb950, #10b981)" }}>⏰</div>
              <div>
                <h3>Jadwal Berikutnya</h3>
                <p className="card-subtitle">{totalSchedules} jadwal aktif</p>
              </div>
            </div>
            {nextSched ? (
              <div className="next-sched-body">
                <div className="next-sched-time">{nextSched.time} <span className="tz-label">WIB</span></div>
                <div className="next-sched-countdown">
                  {enabled ? `≈ ${nextSched.countdown}` : "Sistem nonaktif — jadwal dijeda"}
                </div>
                <div className="next-sched-schedules">
                  {enabledSchedules.map((s, i) => (
                    <span key={i} className={`sched-chip${s.time === nextSched.time ? " active" : ""}`}>
                      {s.time}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="next-sched-body">
                <div className="next-sched-time muted">—</div>
                <div className="next-sched-countdown">Belum ada jadwal aktif</div>
              </div>
            )}
          </div>

          <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
            <div className="card-header">
              <div className="card-icon" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>📋</div>
              <div>
                <h3>Status Terakhir</h3>
                <p className="card-subtitle">Run terbaru & aktivitas</p>
              </div>
            </div>
            {lastRun ? (
              <div className="last-run-body">
                <div className="last-run-row">
                  <span className="last-run-label">Run</span>
                  <span className="last-run-value">#{lastRun.id}</span>
                </div>
                <div className="last-run-row">
                  <span className="last-run-label">Status</span>
                  <span className={`badge-pill ${lastRun.status === "completed" || lastRun.status === "running" ? "badge-active" : "badge-inactive"}`}>
                    <span className="badge-dot"></span>
                    {lastRun.status}
                  </span>
                </div>
                <div className="last-run-row">
                  <span className="last-run-label">Trigger</span>
                  <span className="last-run-value">{lastRun.triggered_by}</span>
                </div>
                <div className="last-run-row">
                  <span className="last-run-label">Mulai</span>
                  <span className="last-run-value">{toWIB(lastRun.started_at)}</span>
                </div>
                {lastRun.duration_minutes != null && (
                  <div className="last-run-row">
                    <span className="last-run-label">Durasi</span>
                    <span className="last-run-value">{lastRun.duration_minutes} mnt</span>
                  </div>
                )}
                {lastRun.et0 != null && (
                  <div className="last-run-row">
                    <span className="last-run-label">ET0</span>
                    <span className="last-run-value">{lastRun.et0.toFixed(3)}</span>
                  </div>
                )}
                {lastRun.soil_avg != null && (
                  <div className="last-run-row">
                    <span className="last-run-label">Soil</span>
                    <span className="last-run-value">{lastRun.soil_avg.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="muted" style={{ padding: "12px 0" }}>Belum ada run.</p>
            )}
            {lastEvent && (
              <div className="last-event">
                <span>{lastEvent.level === "info" ? "ℹ️" : lastEvent.level === "warn" ? "⚠️" : "🚨"}</span>
                <span className="event-text">{lastEvent.event}</span>
                <span className="event-time">{toWIB(lastEvent.ts)}</span>
              </div>
            )}
          </div>

          {/* Duration chart — right column of row 2 */}
          <DurationChartSlot />

          {/* ── Row 3: Channel (2col) | ET0 chart (2col) | Soil chart (2col) */}
          <div className="dash-card glass-card" style={{ gridColumn: "span 2" }}>
            <div className="card-header">
              <div className="card-icon" style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}>⚡</div>
              <div>
                <h3>Channel Aktif</h3>
                <p className="card-subtitle">{active.length} channel menyala</p>
              </div>
            </div>
            {active.length === 0 ? (
              <div className="channel-empty">
                <span style={{ fontSize: 28, opacity: 0.4 }}>💤</span>
                <span className="muted">Tidak ada channel menyala</span>
              </div>
            ) : (
              <>
                <div className="channel-list">
                  {active.map((c) => (
                    <div key={c.id} className="channel-item">
                      <div className="channel-role-badge">{c.role === "pump" ? "🔌" : "🚰"} {c.role}</div>
                      <div className="channel-detail">
                        <span>Ch {c.channel}</span>
                        <span className="muted">Run #{c.run_id}</span>
                      </div>
                      <div className="channel-times">
                        <span className="channel-on">ON {toWIB(c.on_at)}</span>
                        <span className="channel-off">OFF ~{toWIB(c.expected_off_at)}</span>
                      </div>
                      <span className={`channel-verified ${c.verified ? "yes" : "no"}`}>
                        {c.verified ? "✓" : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {runningRunIds.length > 0 && (
                  <div className="channel-actions">
                    {runningRunIds.map((rid) => (
                      <form key={rid} action={stopRunAction}>
                        <input type="hidden" name="run_id" value={rid} />
                        <SubmitButton className="danger" pendingText="Menghentikan…">
                          ■ Stop #{rid}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ET0 + Soil charts — right 4 cols of row 3 */}
          <ET0ChartSlot />
          <SoilChartSlot />

          {/* ── Row 4: Timeline (full width) ─────────────────────────── */}
          <TimelineSlot />

          {/* ── Row 5: Riwayat table (full width) ────────────────────── */}
          <div className="dash-card glass-card" style={{ gridColumn: "span 6" }}>
            <div className="card-header">
              <div className="card-icon" style={{ background: "linear-gradient(135deg, #64748b, #475569)" }}>📜</div>
              <div>
                <h3>Riwayat Penyiraman</h3>
                <p className="card-subtitle">10 run terakhir</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Trigger</th>
                    <th>Mulai (WIB)</th>
                    <th>Durasi</th>
                    <th>Status</th>
                    <th>ET0</th>
                    <th>Soil</th>
                    <th>Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td><span className="run-id">#{r.id}</span></td>
                      <td>
                        <span className={`trigger-badge ${r.triggered_by}`}>
                          {r.triggered_by === "schedule" ? "🕐" : "👆"} {r.triggered_by}
                        </span>
                      </td>
                      <td>{toWIB(r.started_at)}</td>
                      <td>{r.duration_minutes != null ? `${r.duration_minutes} mnt` : "—"}</td>
                      <td>
                        <span className={`badge-pill ${
                          r.status === "completed" ? "badge-active"
                            : r.status === "running" ? "badge-running"
                            : r.status === "failed" ? "badge-danger"
                            : "badge-inactive"
                        }`}>
                          <span className="badge-dot"></span>
                          {r.status}
                        </span>
                      </td>
                      <td>{r.et0 != null ? r.et0.toFixed(3) : "—"}</td>
                      <td>{r.soil_avg != null ? `${r.soil_avg.toFixed(1)}%` : "—"}</td>
                      <td>{toWIB(r.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DashboardDataProvider>
    </>
  );
}
