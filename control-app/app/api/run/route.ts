import { NextRequest, NextResponse } from "next/server";
import { runIrrigation } from "@/lib/irrigation";
import { logEvent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/run { duration_minutes, triggered_by, et0?, soil_avg?, weather_snapshot? }
// Runs the full ON sequence (valve -> 7s -> pump). Open endpoint (brain calls it).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const duration = Number(body.duration_minutes);
  const triggeredBy =
    body.triggered_by === "schedule"
      ? "schedule"
      : body.triggered_by === "manual"
        ? "manual"
        : null;

  if (!(duration > 0)) {
    return NextResponse.json(
      { error: "duration_minutes must be a positive number" },
      { status: 400 }
    );
  }
  if (!triggeredBy) {
    return NextResponse.json(
      { error: "triggered_by must be 'schedule' or 'manual'" },
      { status: 400 }
    );
  }

  try {
    const result = await runIrrigation({
      duration_minutes: duration,
      triggered_by: triggeredBy,
      et0: body.et0 == null ? null : Number(body.et0),
      soil_avg: body.soil_avg == null ? null : Number(body.soil_avg),
      weather_snapshot: body.weather_snapshot ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    logEvent("error", "api_run_failed", { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
