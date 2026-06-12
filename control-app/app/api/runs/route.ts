import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runs?limit=50 — irrigation history for the UI.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 500);

  const runs = getDb()
    .prepare(
      `SELECT id, triggered_by, started_at, duration_minutes, status, et0, soil_avg,
              finished_at, notes
       FROM irrigation_runs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit);

  return NextResponse.json({ count: runs.length, runs });
}
