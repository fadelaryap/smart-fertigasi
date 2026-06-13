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
