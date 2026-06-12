import { NextResponse } from "next/server";
import { reloadSchedules } from "@/lib/scheduler";
import { logEvent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scheduler/reload — re-register cron jobs from the DB. Called after the
// UI changes schedules, and handy for testing.
export async function POST() {
  try {
    const status = reloadSchedules();
    return NextResponse.json(status);
  } catch (err) {
    logEvent("error", "scheduler_reload_failed", { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
