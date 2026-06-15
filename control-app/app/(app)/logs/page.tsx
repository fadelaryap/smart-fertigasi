import Link from "next/link";
import { getDb } from "@/lib/db";
import { toWIB } from "@/lib/time";
import { FilterForm, Pagination } from "../pagination";

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
  const startDate = typeof searchParams?.startDate === "string" ? searchParams.startDate : "";
  const endDate = typeof searchParams?.endDate === "string" ? searchParams.endDate : "";
  const sort = typeof searchParams?.sort === "string" ? searchParams.sort : "desc";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const limit = 150;
  const offset = (page > 0 ? page - 1 : 0) * limit;

  let whereClause = "1=1";
  const params: any[] = [];
  if (startDate) {
    whereClause += " AND date(ts) >= ?";
    params.push(startDate);
  }
  if (endDate) {
    whereClause += " AND date(ts) <= ?";
    params.push(endDate);
  }
  if (q) {
    whereClause += " AND (event LIKE ? OR detail LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  const orderClause = sort === "asc" ? "ASC" : "DESC";

  const db = getDb();
  const totalLogs = (db.prepare(`SELECT COUNT(*) as cnt FROM event_log WHERE ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const totalPages = Math.ceil(totalLogs / limit) || 1;

  const rows = db
    .prepare(`SELECT id, ts, level, event, detail FROM event_log WHERE ${whereClause} ORDER BY id ${orderClause} LIMIT ${limit} OFFSET ${offset}`)
    .all(...params) as EventRow[];

  return (
    <div className="panel">
      <h1>Event log</h1>
      <p className="muted">Total {totalLogs} entri (menampilkan {limit} entri per halaman).</p>

      <div style={{ background: "var(--panel-bg)", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 16 }}>
        <FilterForm basePath="/logs" startDate={startDate} endDate={endDate} sort={sort} q={q} resetPath="/logs" csvPath="/api/logs/csv" />
        <Pagination page={page} totalPages={totalPages} basePath="/logs" searchParams={searchParams || {}} />
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 768px) {
          .log-table thead { display: none; }
          .log-table tbody tr {
            display: flex; flex-direction: column;
            margin-bottom: 12px; padding: 12px;
            background: var(--bg); border: 1px solid var(--border);
            border-radius: 8px;
          }
          .log-table tbody td {
            display: block; padding: 4px 0; border: none;
            white-space: normal !important;
          }
          .log-table tbody td::before {
            content: attr(data-label);
            font-weight: 600; color: var(--muted);
            font-size: 11px; text-transform: uppercase;
            display: block; margin-bottom: 2px;
          }
        }
      `}} />
      <div className="table-wrap">
      <table className="log-table">
        <thead>
          <tr>
            <th>Waktu (WIB)</th>
            <th>Level</th>
            <th>Event</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="Waktu" style={{ whiteSpace: "nowrap" }}>{toWIB(r.ts)}</td>
              <td data-label="Level" style={{ color: LEVEL_COLOR[r.level] ?? "inherit", fontWeight: 600 }}>
                {r.level}
              </td>
              <td data-label="Event">{r.event}</td>
              <td data-label="Detail" style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", whiteSpace: "normal" }}>
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      
      <div style={{ background: "var(--panel-bg)", borderRadius: 8, border: "1px solid var(--border)", marginTop: 16 }}>
        <Pagination page={page} totalPages={totalPages} basePath="/logs" searchParams={searchParams || {}} />
      </div>
    </div>
  );
}
