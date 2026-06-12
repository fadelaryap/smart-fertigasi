// Shared helpers for the migrate/seed scripts (plain ESM, no TS compile needed).
// Node always runs these from the control-app/ directory (npm run migrate|seed).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// repo root = parent of control-app/
export const repoRoot = path.resolve(process.cwd(), "..");

// Minimal .env loader: reads <repo-root>/.env and fills process.env WITHOUT
// overriding anything already set in the real environment. No dependency needed.
export function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
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

// Resolve DB_PATH (relative paths are anchored at the repo root).
export function resolveDbPath() {
  const p = process.env.DB_PATH || "db/fertigation.db";
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

// Open the DB with the pragmas every component must use (WAL is mandatory for
// the multi-process Control App + watchdog setup).
export function openDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}
