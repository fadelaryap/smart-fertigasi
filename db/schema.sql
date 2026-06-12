-- AgriHub Fertigation — SQLite schema (WAL mode set at connection time).
-- All timestamps are ISO-8601 UTC strings with a trailing 'Z' (e.g. 2026-06-12T09:00:00Z)
-- so Node and Python parse them identically. Idempotent: safe to re-run.

-- Fuzzy controller parameters — single active row (id = 1).
-- Column names mirror the Python `FuzzyConfig` dataclass exactly so brain.py can do
-- FuzzyConfig(**row) without remapping.
CREATE TABLE IF NOT EXISTS fuzzy_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  -- Soil moisture ranges (%)
  sdmin       REAL NOT NULL,
  snmin       REAL NOT NULL,
  sdmax       REAL NOT NULL,
  swmin       REAL NOT NULL,
  snmax       REAL NOT NULL,
  swmax       REAL NOT NULL,
  -- ET0 ranges (mm/hour)
  elmin       REAL NOT NULL,
  emmin       REAL NOT NULL,
  elmax       REAL NOT NULL,
  ehmin       REAL NOT NULL,
  emmax       REAL NOT NULL,
  ehmax       REAL NOT NULL,
  -- Output duration ranges (minutes)
  os          REAL NOT NULL,
  om          REAL NOT NULL,
  ol          REAL NOT NULL,
  output_max  REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Device/channel mapping (Sonoff 4CHPROR3). Editable from the UI.
CREATE TABLE IF NOT EXISTS device_config (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL CHECK (role IN ('valve','pump')),
  device_id  TEXT NOT NULL,
  channel    INTEGER NOT NULL,
  label      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1
);

-- Watering schedule (dynamic, read by the internal scheduler).
CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  time       TEXT NOT NULL,                 -- 'HH:MM'
  enabled    INTEGER NOT NULL DEFAULT 1,
  timezone   TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Single-value settings (key/value). Secrets like eWeLink creds live in .env, NOT here.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per irrigation execution.
CREATE TABLE IF NOT EXISTS irrigation_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by     TEXT NOT NULL CHECK (triggered_by IN ('schedule','manual')),
  started_at       TEXT,
  duration_minutes REAL,
  status           TEXT NOT NULL CHECK (status IN ('running','completed','skipped','failed')),
  et0              REAL,
  soil_avg         REAL,
  weather_snapshot TEXT,                    -- JSON
  finished_at      TEXT,
  notes            TEXT
);

-- Live per-channel state — the watchdog's source of truth for shutoff.
CREATE TABLE IF NOT EXISTS channel_state (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER REFERENCES irrigation_runs(id),
  device_id       TEXT NOT NULL,
  channel         INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('valve','pump')),
  state           TEXT NOT NULL CHECK (state IN ('on','off')),
  on_at           TEXT,
  expected_off_at TEXT,                     -- now + duration; watchdog turns off at/after this
  verified        INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_channel_state_on ON channel_state(state);

-- Audit trail of every action, verification, and notification.
CREATE TABLE IF NOT EXISTS event_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  level  TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  event  TEXT NOT NULL,
  detail TEXT                               -- JSON
);
CREATE INDEX IF NOT EXISTS idx_event_log_ts ON event_log(ts);

-- UI login users (control APIs stay open; only the settings UI requires login).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- format: scrypt$<saltHex>$<hashHex>
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Telegram subscribers (subscribe model). Users send /subscribe to the bot; all
-- notifications are broadcast to every active subscriber. Populated by the bot
-- poller in the Control App (lib/telegram-bot.ts).
CREATE TABLE IF NOT EXISTS subscribers (
  chat_id         TEXT PRIMARY KEY,
  name            TEXT,
  username        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  subscribed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unsubscribed_at TEXT
);
