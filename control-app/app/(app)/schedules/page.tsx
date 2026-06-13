import { getDb } from "@/lib/db";
import { addSchedule, toggleSchedule, deleteSchedule } from "./actions";
import { SubmitButton } from "../../submit-button";

export const dynamic = "force-dynamic";

interface ScheduleRow {
  id: number;
  time: string;
  enabled: number;
  timezone: string;
}

export default function SchedulesPage() {
  const rows = getDb()
    .prepare("SELECT id, time, enabled, timezone FROM schedules ORDER BY time")
    .all() as ScheduleRow[];

  return (
    <>
      <div className="panel">
        <h1>Jadwal penyiraman</h1>
        <p className="muted">
          Jam dinamis (Asia/Jakarta). Perubahan langsung me-reload scheduler internal.
          Watchdog tetap independen.
        </p>
        <form action={addSchedule} style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <div>
            <label htmlFor="time">Tambah jam (HH:MM)</label>
            <input id="time" name="time" placeholder="07:00" style={{ width: 120 }} />
          </div>
          <SubmitButton pendingText="Menambah…">+ Tambah</SubmitButton>
        </form>
      </div>

      <div className="panel">
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jam</th>
              <th>Timezone</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.time}</td>
                <td>{r.timezone}</td>
                <td>
                  <span className={`badge ${r.enabled ? "on" : "off"}`}>
                    {r.enabled ? "enabled" : "disabled"}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  <form action={toggleSchedule}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="secondary" pendingText={r.enabled ? "Disabling…" : "Enabling…"}>
                      {r.enabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </form>
                  <form action={deleteSchedule}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="danger" pendingText="Menghapus…">
                      Hapus
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Belum ada jadwal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
