import { getDb, isSystemEnabled } from "@/lib/db";
import { isDryRun } from "@/lib/ewelink";
import { toWIB, getNextSchedule } from "@/lib/time";
import { runNowAction, stopRunAction, toggleSystemAction } from "./actions";
import { SubmitButton } from "../submit-button";

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

  // Next schedule
  const enabledSchedules = db
    .prepare("SELECT time FROM schedules WHERE enabled = 1 ORDER BY time")
    .all() as { time: string }[];
  const nextSched = getNextSchedule(enabledSchedules.map((s) => s.time));

  return (
    <>
      <div className="panel dash-header" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <span
          className={`badge ${enabled ? "on" : "off"}`}
          style={enabled ? {} : { color: "var(--danger)" }}
        >
          {enabled ? "SISTEM AKTIF" : "SISTEM NONAKTIF"}
        </span>
        <span className={`badge ${isDryRun() ? "off" : "on"}`}>
          {isDryRun() ? "DRY-RUN" : "LIVE"}
        </span>
        <div className="dash-actions" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <form action={toggleSystemAction}>
            <SubmitButton className={enabled ? "danger" : ""} pendingText={enabled ? "Menonaktifkan…" : "Mengaktifkan…"}>
              {enabled ? "■ Nonaktifkan sistem" : "▶ Aktifkan sistem"}
            </SubmitButton>
          </form>
          <form action={runNowAction}>
            <SubmitButton disabled={!enabled} pendingText="Menjalankan…">
              ▶ Run now
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Next schedule card */}
      {nextSched ? (
        <div className={`next-schedule${enabled ? "" : " disabled"}`}>
          <div className="icon">⏱️</div>
          <div className="info">
            <div className="label">Jadwal berikutnya</div>
            <div className="time">{nextSched.time} WIB</div>
            <div className="countdown">
              {enabled ? `≈ ${nextSched.countdown}` : "Sistem nonaktif — jadwal dijeda"}
            </div>
          </div>
        </div>
      ) : (
        <div className="next-schedule disabled">
          <div className="icon">📅</div>
          <div className="info">
            <div className="label">Jadwal berikutnya</div>
            <div className="time">—</div>
            <div className="countdown">Belum ada jadwal aktif</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Status terakhir</h2>
        {lastRun ? (
          <p style={{ margin: "4px 0" }}>
            Run #{lastRun.id} ·{" "}
            <span
              className={`badge ${lastRun.status === "completed" || lastRun.status === "running" ? "on" : "off"}`}
            >
              {lastRun.status}
            </span>{" "}
            · {lastRun.triggered_by} · mulai {toWIB(lastRun.started_at)}
            {lastRun.duration_minutes != null ? ` · ${lastRun.duration_minutes} mnt` : ""}
            {lastRun.et0 != null ? ` · ET0 ${lastRun.et0.toFixed(3)}` : ""}
            {lastRun.soil_avg != null ? ` · soil ${lastRun.soil_avg.toFixed(1)}%` : ""}
          </p>
        ) : (
          <p className="muted">Belum ada run.</p>
        )}
        {lastEvent && (
          <p className="muted" style={{ margin: "4px 0" }}>
            Aktivitas terakhir: [{lastEvent.level}] {lastEvent.event} · {toWIB(lastEvent.ts)}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Channel aktif</h2>
        {active.length === 0 ? (
          <p className="muted">Tidak ada channel menyala.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Device</th>
                  <th>Ch</th>
                  <th>Role</th>
                  <th>On at (WIB)</th>
                  <th>Expected off (WIB)</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.run_id}</td>
                    <td>{c.device_id}</td>
                    <td>{c.channel}</td>
                    <td>{c.role}</td>
                    <td>{toWIB(c.on_at)}</td>
                    <td>{toWIB(c.expected_off_at)}</td>
                    <td>{c.verified ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runningRunIds.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {runningRunIds.map((rid) => (
              <form key={rid} action={stopRunAction}>
                <input type="hidden" name="run_id" value={rid} />
                <SubmitButton className="danger" pendingText="Menghentikan…">
                  ■ Stop run #{rid}
                </SubmitButton>
              </form>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Riwayat penyiraman (10 terakhir)</h2>
        <div className="table-wrap">
          <table>
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
                  <td>{r.id}</td>
                  <td>{r.triggered_by}</td>
                  <td>{toWIB(r.started_at)}</td>
                  <td>{r.duration_minutes != null ? `${r.duration_minutes} mnt` : "—"}</td>
                  <td>
                    <span
                      className={`badge ${r.status === "running" ? "on" : "off"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>{r.et0 != null ? r.et0.toFixed(3) : "—"}</td>
                  <td>{r.soil_avg != null ? r.soil_avg.toFixed(1) : "—"}</td>
                  <td>{toWIB(r.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
