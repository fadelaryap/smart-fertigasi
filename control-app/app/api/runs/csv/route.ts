import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toWIB } from "@/lib/time";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const sort = searchParams.get("sort") === "asc" ? "ASC" : "DESC";

  let whereClause = "1=1";
  const params: any[] = [];
  if (startDate) {
    whereClause += " AND date(started_at) >= ?";
    params.push(startDate);
  }
  if (endDate) {
    whereClause += " AND date(started_at) <= ?";
    params.push(endDate);
  }

  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM irrigation_runs WHERE ${whereClause} ORDER BY id ${sort}`)
    .all(...params) as any[];

  const header = ["ID", "Trigger", "Mulai (WIB)", "Durasi (mnt)", "Status", "ET0", "Soil (%)", "Selesai (WIB)"];
  const csvRows = [header.join(",")];

  for (const r of rows) {
    const line = [
      r.id,
      r.triggered_by,
      toWIB(r.started_at),
      r.duration_minutes ?? "",
      r.status,
      r.et0 != null ? r.et0.toFixed(3) : "",
      r.soil_avg != null ? r.soil_avg.toFixed(1) : "",
      toWIB(r.finished_at)
    ];
    csvRows.push(line.join(","));
  }

  const csvString = csvRows.join("\n");
  
  return new NextResponse(csvString, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="riwayat_penyiraman_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
