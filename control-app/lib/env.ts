// Loads the single root .env into process.env for the Next.js runtime.
// Next only auto-loads .env from control-app/, but our single source of truth is
// <repo-root>/.env (shared with the Python brain/watchdog). Import this once,
// early (lib/db.ts imports it), before reading any secret.
import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  // Next runs with cwd = control-app/, so the repo root is one level up.
  const envPath = path.resolve(process.cwd(), "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// Read a required env var with no insecure fallback. Throws if missing — this is
// intentional: we never want a `process.env.X || "secret"` default in the code.
export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name} (set it in <repo-root>/.env)`);
  }
  return v;
}

export function optionalEnv(name: string, fallback = ""): string {
  loadEnv();
  const v = process.env[name];
  return v === undefined ? fallback : v;
}
