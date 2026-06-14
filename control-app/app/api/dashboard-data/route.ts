import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RunRow {
  id: number;
  triggered_by: string;
  started_at: string | null;
  duration_minutes: number | null;
  status: string;
  et0: number | null;
  soil_avg: number | null;
  finished_at: string | null;
}

interface ScheduleRow {
  time: string;
}

export async function GET() {
  const db = getDb();

  // Fixed 3-day window
  const now = new Date();
  const rangeEnd = now.toISOString();
  const rangeStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Get runs within last 3 days
  const runs = db
    .prepare(
      "SELECT * FROM irrigation_runs WHERE started_at >= ? ORDER BY started_at ASC"
    )
    .all(rangeStart) as RunRow[];

  // Get enabled schedules
  const schedules = db
    .prepare("SELECT time FROM schedules WHERE enabled = 1 ORDER BY time")
    .all() as ScheduleRow[];

  const scheduleTimes = schedules.map((s) => s.time);

  // Build schedule bars
  const bars = runs
    .filter((r) => r.started_at && r.status !== "skipped")
    .map((r) => {
      const startDate = new Date(r.started_at!);
      const dateStr = startDate.toLocaleDateString("sv-SE", {
        timeZone: "Asia/Jakarta",
      });

      const wibStart = new Date(startDate.getTime() + 7 * 60 * 60 * 1000);
      const actualOn = `${wibStart.getUTCHours().toString().padStart(2, "0")}:${wibStart
        .getUTCMinutes()
        .toString()
        .padStart(2, "0")}`;

      let actualOff: string | null = null;
      if (r.finished_at) {
        const endDate = new Date(r.finished_at);
        const wibEnd = new Date(endDate.getTime() + 7 * 60 * 60 * 1000);
        actualOff = `${wibEnd.getUTCHours().toString().padStart(2, "0")}:${wibEnd
          .getUTCMinutes()
          .toString()
          .padStart(2, "0")}`;
      } else if (r.duration_minutes) {
        const estEnd = new Date(wibStart.getTime() + r.duration_minutes * 60 * 1000);
        actualOff = `${estEnd.getUTCHours().toString().padStart(2, "0")}:${estEnd
          .getUTCMinutes()
          .toString()
          .padStart(2, "0")}`;
      }

      const actualOnMin = wibStart.getUTCHours() * 60 + wibStart.getUTCMinutes();
      let bestSchedule = scheduleTimes[0] || actualOn;
      let bestDiff = Infinity;
      for (const st of scheduleTimes) {
        const [sh, sm] = st.split(":").map(Number);
        const diff = Math.abs(sh * 60 + sm - actualOnMin);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSchedule = st;
        }
      }

      const [bh, bm] = bestSchedule.split(":").map(Number);
      const schedOnMin = bh * 60 + bm;
      const dur = r.duration_minutes || 15;
      const schedOffMin = schedOnMin + dur;
      const scheduledOff = `${Math.floor(schedOffMin / 60)
        .toString()
        .padStart(2, "0")}:${(schedOffMin % 60).toString().padStart(2, "0")}`;

      return {
        date: dateStr,
        scheduledOn: bestSchedule,
        scheduledOff,
        actualOn,
        actualOff,
      };
    });

  // Run data points with ISO timestamps for time-based x-axis
  const runDataPoints = runs
    .filter((r) => r.started_at)
    .map((r) => ({
      date: new Date(r.started_at!).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Jakarta",
      }),
      startedAtIso: r.started_at!,
      durationMinutes: r.duration_minutes || 0,
      et0: r.et0,
      soilAvg: r.soil_avg,
      status: r.status,
    }));

  return NextResponse.json({
    bars,
    runDataPoints,
    rangeStart,
    rangeEnd,
  });
}
