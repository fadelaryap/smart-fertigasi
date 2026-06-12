// SQLite connection for the Control App. WAL mode is mandatory: the watchdog
// (separate Python process) reads/writes the same file concurrently.
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { loadEnv } from "./env";

loadEnv();

function resolveDbPath(): string {
  // Relative DB_PATH is anchored at the repo root (cwd is control-app/).
  const p = process.env.DB_PATH || "db/fertigation.db";
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), "..", p);
}

// Reuse one connection across hot reloads in dev (avoid leaking handles).
const globalForDb = globalThis as unknown as { __fertigationDb?: DB };

function open(): DB {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__fertigationDb) {
    globalForDb.__fertigationDb = open();
  }
  return globalForDb.__fertigationDb;
}

// --- Small typed helpers reused across the app -------------------------------

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export type EventLevel = "info" | "warn" | "error";

export function logEvent(
  level: EventLevel,
  event: string,
  detail?: unknown
): void {
  getDb()
    .prepare(
      "INSERT INTO event_log (ts, level, event, detail) VALUES (?, ?, ?, ?)"
    )
    .run(
      new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      level,
      event,
      detail === undefined ? null : JSON.stringify(detail)
    );
}
