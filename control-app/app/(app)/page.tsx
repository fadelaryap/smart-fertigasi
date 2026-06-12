import { getDb } from "@/lib/db";
import { isDryRun } from "@/lib/ewelink";
import { runNowAction, stopRunAction } from "./actions";

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

  return (
    <>
      <div className="panel" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <span className={`badge ${isDryRun() ? "off" : "on"}`}>
          {isDryRun() ? "DRY-RUN (relay tidak dipicu)" : "LIVE (relay aktif)"}
        </span>
        <form action={runNowAction} style={{ marginLeft: "auto" }}>
          <button type="submit">▶ Run now (manual)</button>
        </form>
      </div>

      <div className="panel">
        <h2>Channel aktif</h2>
        {active.length === 0 ? (
          <p className="muted">Tidak ada channel menyala.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Device</th>
                <th>Ch</th>
                <th>Role</th>
                <th>On at (UTC)</th>
                <th>Expected off (UTC)</th>
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
                  <td>{c.on_at}</td>
                  <td>{c.expected_off_at}</td>
                  <td>{c.verified ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {runningRunIds.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {runningRunIds.map((rid) => (
              <form key={rid} action={stopRunAction}>
                <input type="hidden" name="run_id" value={rid} />
                <button className="danger" type="submit">
                  ■ Stop run #{rid}
                </button>
              </form>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Riwayat penyiraman (10 terakhir)</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Trigger</th>
              <th>Mulai (UTC)</th>
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
                <td>{r.started_at}</td>
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
                <td>{r.finished_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
