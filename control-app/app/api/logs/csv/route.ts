import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toWIB } from "@/lib/time";

interface EventRow {
  id: number;
  ts: string;
  level: string;
  event: string;
  detail: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const sort = searchParams.get("sort") === "asc" ? "ASC" : "DESC";

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

  const db = getDb();
  const rows = db
    .prepare(`SELECT id, ts, level, event, detail FROM event_log WHERE ${whereClause} ORDER BY id ${sort}`)
    .all(...params) as EventRow[];

  // Build CSV
  const header = ["ID", "Waktu (WIB)", "Level", "Event", "Detail"];
  const csvRows = [header.join(",")];

  for (const r of rows) {
    // escape quotes in detail JSON
    const detailStr = r.detail ? r.detail.replace(/"/g, '""') : "";
    const line = [
      r.id,
      toWIB(r.ts),
      r.level,
      r.event,
      `"${detailStr}"`
    ];
    csvRows.push(line.join(","));
  }

  const csvString = csvRows.join("\n");
  
  return new NextResponse(csvString, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="event_log_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
