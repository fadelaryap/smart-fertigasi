import Link from "next/link";
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

export default async function LogsPage(props: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  const pageStr = searchParams?.page;
  const page = typeof pageStr === "string" ? parseInt(pageStr, 10) : 1;
  const limit = 150;
  const offset = (page > 0 ? page - 1 : 0) * limit;

  const db = getDb();
  const totalLogs = (db.prepare("SELECT COUNT(*) as cnt FROM event_log").get() as { cnt: number }).cnt;
  const totalPages = Math.ceil(totalLogs / limit) || 1;

  const rows = db
    .prepare(`SELECT id, ts, level, event, detail FROM event_log ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`)
    .all() as EventRow[];

  return (
    <div className="panel">
      <h1>Event log</h1>
      <p className="muted">Total {totalLogs} entri (menampilkan {limit} entri per halaman).</p>
      <div className="table-wrap">
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
              <td style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", whiteSpace: "normal" }}>
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {/* Pagination Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", marginTop: "16px", borderTop: "1px solid var(--border)" }}>
        {page > 1 ? (
          <Link href={`/logs?page=${page - 1}`} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
            &larr; Sebelumnya
          </Link>
        ) : (
          <span className="btn-secondary muted" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", opacity: 0.5 }}>
            &larr; Sebelumnya
          </span>
        )}
        <span className="muted" style={{ fontSize: 13 }}>
          Halaman {page} dari {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={`/logs?page=${page + 1}`} className="btn-secondary" style={{ padding: "6px 12px", borderRadius: 6, textDecoration: "none", fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", color: "var(--fg)" }}>
            Selanjutnya &rarr;
          </Link>
        ) : (
          <span className="btn-secondary muted" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, background: "var(--panel-solid)", border: "1px solid var(--border)", opacity: 0.5 }}>
            Selanjutnya &rarr;
          </span>
        )}
      </div>
    </div>
  );
}
