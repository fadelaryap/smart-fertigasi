import { NextRequest, NextResponse } from "next/server";
import { stopIrrigation } from "@/lib/irrigation";
import { logEvent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/stop { run_id } — runs the full OFF sequence (pump -> valves).
// Open endpoint (the watchdog calls it). Idempotent.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const runId = Number(body.run_id);
  if (!Number.isInteger(runId)) {
    return NextResponse.json({ error: "run_id (integer) is required" }, { status: 400 });
  }

  try {
    const result = await stopIrrigation(runId);
    if ("notFound" in result) {
      return NextResponse.json({ error: `run ${runId} not found` }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    logEvent("error", "api_stop_failed", { run_id: runId, error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
