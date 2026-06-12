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
