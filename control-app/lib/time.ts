// ISO-8601 UTC timestamp helpers. Format matches the Python side exactly
// (no milliseconds, trailing 'Z') so both runtimes parse identically.
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export function isoPlusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
}

// Convert a UTC ISO-8601 timestamp (e.g. "2026-06-13T10:45:38Z") to
// a human-readable WIB (Asia/Jakarta, UTC+7) string for display.
// Returns the original value as-is if parsing fails.
export function toWIB(utc: string | null | undefined): string {
  if (!utc) return "—";
  try {
    const d = new Date(utc);
    if (isNaN(d.getTime())) return utc;
    return d.toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return utc;
  }
}

// Compute the next schedule firing time from a list of enabled HH:MM times.
// All schedule times are in Asia/Jakarta. Returns null if no schedules.
export interface NextScheduleInfo {
  time: string;        // "07:00" or "16:00"
  nextFire: Date;      // exact Date of next firing (UTC)
  countdown: string;   // e.g. "2 jam 15 menit lagi"
  minutesLeft: number;
}

export function getNextSchedule(
  times: string[]
): NextScheduleInfo | null {
  if (times.length === 0) return null;

  // Get current time in WIB
  const now = new Date();
  const wibStr = now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
  const wibNow = new Date(wibStr);
  const nowMinutes = wibNow.getHours() * 60 + wibNow.getMinutes();

  // Parse and sort schedule times
  const parsed = times
    .map((t) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
      if (!m) return null;
      return { time: t, minutes: Number(m[1]) * 60 + Number(m[2]) };
    })
    .filter((x): x is { time: string; minutes: number } => x !== null)
    .sort((a, b) => a.minutes - b.minutes);

  if (parsed.length === 0) return null;

  // Find next schedule: first one after current WIB time, or wrap to tomorrow's first
  let chosen = parsed.find((s) => s.minutes > nowMinutes);
  let addDay = false;
  if (!chosen) {
    chosen = parsed[0]; // wrap around to tomorrow
    addDay = true;
  }

  let minutesLeft = chosen.minutes - nowMinutes;
  if (addDay) minutesLeft += 24 * 60;

  // Compute actual UTC Date of next firing
  // WIB = UTC+7, so we build the target WIB date then convert
  const targetWib = new Date(wibNow);
  targetWib.setHours(Math.floor(chosen.minutes / 60), chosen.minutes % 60, 0, 0);
  if (addDay) targetWib.setDate(targetWib.getDate() + 1);
  // Convert WIB back to UTC: subtract 7 hours
  const nextFire = new Date(targetWib.getTime() - 7 * 60 * 60 * 1000);

  // Countdown string
  const hours = Math.floor(minutesLeft / 60);
  const mins = minutesLeft % 60;
  let countdown = "";
  if (hours > 0) countdown += `${hours} jam `;
  countdown += `${mins} menit lagi`;

  return { time: chosen.time, nextFire, countdown, minutesLeft };
}

