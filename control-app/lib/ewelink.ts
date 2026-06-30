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
//  - If the cached token gets revoked (e.g. the same account logs in on the
//    eWeLink phone app), calls are wrapped in withReauth(), which detects the
//    auth error and re-logs-in once automatically (see AUTH_ERROR_CODES).
import { requireEnv, optionalEnv } from "./env";
import { logEvent, getDb, getSetting } from "./db";

// ewelink-api (old, skydiver) is CommonJS and ships no types.
import ewelink from "ewelink-api";

export type PowerState = "on" | "off";

let connection: any | null = null;

export function isDryRun(): boolean {
  // Anything other than an explicit "0" keeps dry-run ON (fail-safe).
  const val = getSetting("ewelink_dry_run");
  return val !== "0";
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

// eWeLink error codes that mean "our cached session/token is no longer valid".
// The usual trigger is the same account logging in elsewhere (e.g. the phone
// app), which revokes our token. Note 401 is misleadingly mapped to "Wrong
// account or password" by the library even though the credentials are fine — it
// is really a dead token, not a bad password.
const AUTH_ERROR_CODES = new Set([401, 403, 406]);

// Returns the auth error code if `result` is one of the library's `{error}`
// failure objects carrying an auth-related code, otherwise null.
function authErrorCode(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const err = (result as { error?: unknown }).error;
  const code = Number(err);
  return err && AUTH_ERROR_CODES.has(code) ? code : null;
}

// Runs an eWeLink operation against the cached connection. If the call comes
// back as an auth failure — either a returned `{error}` object (the library's
// normal failure mode; it does NOT throw on API errors) or a thrown exception —
// we drop the connection and retry ONCE. The retry runs against a fresh
// connection whose token is empty, so makeRequest performs a real login again.
// That transparently re-establishes our session after the phone app kicked us
// off (and, per eWeLink's single-session rule, kicks the phone off in turn).
async function withReauth<T>(op: (conn: any) => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await op(getConnection());
  } catch (err) {
    logEvent("warn", "ewelink_reauth", { reason: "exception", error: String(err) });
    resetConnection();
    return op(getConnection());
  }
  const code = authErrorCode(result);
  if (code !== null) {
    logEvent("warn", "ewelink_reauth", { reason: "auth_error", code });
    resetConnection();
    result = await op(getConnection());
  }
  return result;
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
  return withReauth((c) => c.getDevices());
}

export async function getPowerState(
  deviceId: string,
  channel: number
): Promise<PowerState> {
  if (isDryRun()) {
    return dryRunState(deviceId, channel);
  }
  const res = await withReauth<any>((c) => c.getDevicePowerState(deviceId, channel));
  if ((res as { error?: unknown })?.error) {
    const r = res as { error: unknown; msg?: string };
    throw new Error(`getDevicePowerState failed: ${r.error} ${r.msg ?? ""}`.trim());
  }
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
    const status = await withReauth((c) =>
      c.setDevicePowerState(deviceId, state, channel)
    );
    if ((status as { error?: unknown })?.error) {
      const s = status as { error: unknown; msg?: string };
      throw new Error(`setDevicePowerState failed: ${s.error} ${s.msg ?? ""}`.trim());
    }
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
    const devices = await withReauth((c) => c.getDevices());
    if ((devices as { error?: unknown })?.error) {
      const d = devices as { error: unknown; msg?: string };
      resetConnection();
      return { ok: false, error: `${d.error} ${d.msg ?? ""}`.trim() };
    }
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
