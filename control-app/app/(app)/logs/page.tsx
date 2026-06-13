import { getDb } from "@/lib/db";
import { toWIB } from "@/lib/time";

export const dynamic = "force-dynamic";

interface EventRow {
  id: number;
  ts: string;
  level: string;
  event: string;
  detail: string | null;
}

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--muted)",
  warn: "var(--warn)",
  error: "var(--danger)",
};

export default function LogsPage() {
  const rows = getDb()
    .prepare("SELECT id, ts, level, event, detail FROM event_log ORDER BY id DESC LIMIT 150")
    .all() as EventRow[];

  return (
    <div className="panel">
      <h1>Event log</h1>
      <p className="muted">150 entri terakhir (audit semua aksi, verifikasi, notifikasi).</p>
      <table>
        <thead>
          <tr>
            <th>ts (WIB)</th>
            <th>level</th>
            <th>event</th>
            <th>detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{toWIB(r.ts)}</td>
              <td style={{ color: LEVEL_COLOR[r.level] ?? "inherit", fontWeight: 600 }}>
                {r.level}
              </td>
              <td>{r.event}</td>
              <td style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
