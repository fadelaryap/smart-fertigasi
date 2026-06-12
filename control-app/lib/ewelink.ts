// Wrapper around the old skydiver `ewelink-api` (email+password, region 'as').
//
// Safety:
//  - EWELINK_DRY_RUN defaults to ON. In dry-run NO real relay is ever touched:
//    setPowerState only logs + updates an in-memory shadow, getPowerState returns
//    the shadow, so verification passes. Real hardware is contacted ONLY when
//    EWELINK_DRY_RUN=0 AND credentials are present.
//  - Credentials come from .env via requireEnv() (throws if missing). We never use
//    a `process.env.X || "secret"` fallback.
//  - One connection is created lazily and reused (login/token is cached on the
//    instance) instead of re-logging-in on every call.
import { requireEnv, optionalEnv } from "./env";
import { logEvent } from "./db";
import { getDb } from "./db";

// ewelink-api (old, skydiver) is CommonJS and ships no types.
import ewelink from "ewelink-api";

export type PowerState = "on" | "off";

let connection: any | null = null;

export function isDryRun(): boolean {
  // Anything other than an explicit "0" keeps dry-run ON (fail-safe).
  return optionalEnv("EWELINK_DRY_RUN", "1") !== "0";
}

function getConnection(): any {
  if (connection) return connection;
  connection = new (ewelink as any)({
    email: requireEnv("EWELINK_EMAIL"),
    password: requireEnv("EWELINK_PASSWORD"),
    region: optionalEnv("EWELINK_REGION", "as"),
    APP_ID: requireEnv("EWELINK_APP_ID"),
    APP_SECRET: requireEnv("EWELINK_APP_SECRET"),
  });
  return connection;
}

// Drop the cached connection so the next call performs a fresh login (used after
// an auth-looking failure).
export function resetConnection(): void {
  connection = null;
}

// --- Dry-run shadow state (persisted via event_log) --------------------------
// An in-memory Map would not survive across requests in Next (modules get
// re-instantiated), so dry-run state is derived from the latest `device_set`
// entry that setPowerState writes to event_log. This keeps on/off/status
// coherent across separate HTTP requests without a new table.
function dryRunState(deviceId: string, channel: number): PowerState {
  const row = getDb()
    .prepare(
      `SELECT detail FROM event_log
         WHERE event = 'device_set'
           AND json_extract(detail, '$.device_id') = ?
           AND json_extract(detail, '$.channel') = ?
         ORDER BY id DESC LIMIT 1`
    )
    .get(deviceId, channel) as { detail: string } | undefined;
  if (!row) return "off";
  try {
    return JSON.parse(row.detail).state === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Public API --------------------------------------------------------------

export async function listDevices(): Promise<any[]> {
  if (isDryRun()) {
    // Synthetic list built from device_config so the UI still has something.
    const rows = getDb()
      .prepare("SELECT DISTINCT device_id FROM device_config")
      .all() as { device_id: string }[];
    return rows.map((r) => ({
      deviceid: r.device_id,
      name: `(dry-run) ${r.device_id}`,
      dryRun: true,
    }));
  }
  return getConnection().getDevices();
}

export async function getPowerState(
  deviceId: string,
  channel: number
): Promise<PowerState> {
  if (isDryRun()) {
    return dryRunState(deviceId, channel);
  }
  const res = await getConnection().getDevicePowerState(deviceId, channel);
  return res.state as PowerState;
}

export async function setPowerState(
  deviceId: string,
  channel: number,
  on: boolean
): Promise<void> {
  const state: PowerState = on ? "on" : "off";

  if (isDryRun()) {
    // The event_log entry below IS the persisted dry-run state (see dryRunState).
    logEvent("info", "device_set", {
      device_id: deviceId,
      channel,
      state,
      dry_run: true,
    });
    console.log(`[ewelink:dry-run] set ${deviceId} ch${channel} -> ${state}`);
    return;
  }

  try {
    const status = await getConnection().setDevicePowerState(
      deviceId,
      state,
      channel
    );
    logEvent("info", "device_set", {
      device_id: deviceId,
      channel,
      state,
      dry_run: false,
      status,
    });
  } catch (err) {
    logEvent("error", "device_set_failed", {
      device_id: deviceId,
      channel,
      state,
      error: String(err),
    });
    // Clear the connection in case the token/login went stale.
    resetConnection();
    throw err;
  }
}

// Connectivity test: performs a REAL getDevices (read-only, never toggles a
// relay) regardless of DRY_RUN, so the UI "Test eWeLink" button can verify the
// account/credentials and list devices even while dry-run is on.
export async function testConnection(): Promise<{
  ok: boolean;
  count?: number;
  devices?: { deviceid: string; name?: string; online?: boolean; switches?: unknown }[];
  error?: string;
}> {
  try {
    const devices = await getConnection().getDevices();
    const list = Array.isArray(devices) ? devices : [];
    return {
      ok: true,
      count: list.length,
      devices: list.map((d: any) => ({
        deviceid: d.deviceid,
        name: d.name,
        online: d.online,
        switches: d?.params?.switches ?? d?.params?.switch,
      })),
    };
  } catch (err) {
    resetConnection();
    return { ok: false, error: String(err) };
  }
}

// Verify a channel reached the expected state, retrying a few times before
// giving up. Returns true on match, false if still mismatched after all retries.
// Callers decide whether a false result warrants a Telegram notification.
export async function verifyState(
  deviceId: string,
  channel: number,
  expected: PowerState,
  retries = 3,
  delayMs = 800
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let current: PowerState | null = null;
    try {
      current = await getPowerState(deviceId, channel);
    } catch (err) {
      logEvent("warn", "device_verify_read_failed", {
        device_id: deviceId,
        channel,
        attempt,
        error: String(err),
      });
    }
    if (current === expected) return true;
    if (attempt < retries) await sleep(delayMs);
  }
  logEvent("warn", "device_verify_mismatch", {
    device_id: deviceId,
    channel,
    expected,
  });
  return false;
}
