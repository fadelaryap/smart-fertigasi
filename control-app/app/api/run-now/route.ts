import { NextResponse } from "next/server";
import { spawnBrain } from "@/lib/brain";
import { logEvent, isSystemEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/run-now — manually trigger brain.py (which decides duration via fuzzy
// and calls /api/run). Fire-and-forget: returns 202 immediately; the brain result
// is logged to event_log when it exits. Used by the UI "Run now" button.
export async function POST() {
  if (!isSystemEnabled()) {
    return NextResponse.json(
      { error: "Sistem dinonaktifkan (system_enabled=0)." },
      { status: 409 }
    );
  }
  try {
    spawnBrain("manual");
    return NextResponse.json({ triggered: true }, { status: 202 });
  } catch (err) {
    logEvent("error", "run_now_failed", { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
