// Irrigation orchestration — the safety-critical core.
//
// HARD RULES (spec §4, §15):
//  - ON order is EXPLICIT: open both valves together -> wait pump_delay_on_seconds
//    (default 7) -> start pump. OFF order is the reverse: pump off -> (optional
//    delay) -> valves off.
//  - We NEVER sleep for the watering duration inside the request. We only wait
//    the small, configured pump delay. Shutoff is driven by `expected_off_at` in
//    channel_state + the watchdog. If this process dies mid-run, the watchdog
//    still turns everything off.
//  - Duration is clamped to safety_max_minutes here (defense in depth); the
//    watchdog enforces the absolute safety cutoff independently.
//  - Every ON/OFF is verified (with retry). Mismatch -> Telegram + event_log.
import { getDb, getSetting, logEvent, isSystemEnabled } from "./db";
import { setDeviceChannels, verifyState, isDryRun, type PowerState } from "./ewelink";
import { sendTelegram } from "./telegram";
import { nowIso, isoPlusMinutes, toWIB } from "./time";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DeviceRow {
  device_id: string;
  channel: number;
}
interface ChannelStateRow {
  id: number;
  device_id: string;
  channel: number;
  role: "valve" | "pump";
}
interface RunRow {
  id: number;
  started_at: string | null;
  status: string;
}

export interface RunParams {
  duration_minutes: number;
  triggered_by: "schedule" | "manual";
  et0?: number | null;
  soil_avg?: number | null;
  weather_snapshot?: unknown;
}

function num(setting: string | null, fallback: number): number {
  const n = Number(setting);
  return Number.isFinite(n) ? n : fallback;
}

// Switch a set of channels on/off. Channels that share a physical device are
// sent in a SINGLE multi-channel request (e.g. both valve channels of
// 10023eaccf at once) — this avoids eWeLink's frozen-nonce "401 wrong
// account/password" on close-together commands AND the read-modify-write
// clobber that used to leave one channel on. Distinct devices go sequentially.
async function setDevicesGrouped(rows: DeviceRow[], on: boolean): Promise<void> {
  const byDevice = new Map<string, DeviceRow[]>();
  for (const r of rows) {
    const arr = byDevice.get(r.device_id) ?? [];
    arr.push(r);
    byDevice.set(r.device_id, arr);
  }
  for (const [deviceId, chans] of byDevice) {
    const desired: Record<number, boolean> = {};
    for (const c of chans) desired[c.channel] = on;
    await setDeviceChannels(deviceId, desired);
  }
}

// Drive a set of channels to `on`/`off` and CONFIRM it, retrying the whole
// set+verify up to `attempts` times. Returns the per-row verified flags plus an
// `ok` that is true only when every row reached the expected state. Callers
// decide what an `ok:false` means (abort ON, or refuse to close valves on OFF).
async function ensureDevices(
  rows: DeviceRow[],
  on: boolean,
  attempts = 3
): Promise<{ ok: boolean; verified: boolean[] }> {
  const expected: PowerState = on ? "on" : "off";
  let verified: boolean[] = rows.map(() => false);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await setDevicesGrouped(rows, on);
    } catch (err) {
      logEvent("warn", "device_ensure_set_failed", {
        attempt,
        expected,
        error: String(err),
      });
    }
    verified = await Promise.all(
      rows.map((r) => verifyState(r.device_id, r.channel, expected))
    );
    if (verified.every(Boolean)) return { ok: true, verified };
    logEvent("warn", "device_ensure_retry", {
      attempt,
      expected,
      results: rows.map((r, i) => ({
        device_id: r.device_id,
        channel: r.channel,
        ok: verified[i],
      })),
    });
    if (attempt < attempts) await sleep(1500);
  }
  return { ok: false, verified };
}

// In-process guard so a manual /api/stop and the watchdog's /api/stop (both funnel
// through this single Control App process) can't run the OFF sequence twice.
const stopping = new Set<number>();

// --- ON sequence -------------------------------------------------------------
export async function runIrrigation(p: RunParams) {
  if (!isSystemEnabled()) {
    throw new Error("Sistem dinonaktifkan (system_enabled=0) — penyiraman tidak dijalankan.");
  }
  const db = getDb();
  const valves = db
    .prepare(
      "SELECT device_id, channel FROM device_config WHERE role='valve' AND enabled=1 ORDER BY id"
    )
    .all() as DeviceRow[];
  const pumps = db
    .prepare(
      "SELECT device_id, channel FROM device_config WHERE role='pump' AND enabled=1 ORDER BY id"
    )
    .all() as DeviceRow[];

  if (valves.length === 0 || pumps.length === 0) {
    throw new Error(
      "device_config incomplete: need at least one enabled valve and one enabled pump"
    );
  }

  const pumpDelayOn = num(getSetting("pump_delay_on_seconds"), 7);
  const safetyMax = num(getSetting("safety_max_minutes"), 60);

  const requested = p.duration_minutes;
  if (!(requested > 0)) throw new Error("duration_minutes must be > 0");
  const duration = Math.min(requested, safetyMax);
  const clamped = duration < requested;

  const startedAt = nowIso();
  const expectedOff = isoPlusMinutes(duration);

  const runId = db
    .prepare(
      `INSERT INTO irrigation_runs
         (triggered_by, started_at, duration_minutes, status, et0, soil_avg, weather_snapshot)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`
    )
    .run(
      p.triggered_by,
      startedAt,
      duration,
      p.et0 ?? null,
      p.soil_avg ?? null,
      p.weather_snapshot == null ? null : JSON.stringify(p.weather_snapshot)
    ).lastInsertRowid as number;

  logEvent("info", "run_start", {
    run_id: runId,
    requested_minutes: requested,
    duration_minutes: duration,
    clamped_to_safety: clamped,
    expected_off_at: expectedOff,
  });

  // 1) Open all valves and CONFIRM both are on (set+verify with retry).
  //    If they can't be confirmed, ABORT: never start the pump, close the valves
  //    again, and mark the run failed.
  const valveResult = await ensureDevices(valves, true, 3);
  const valveVerified = valveResult.verified;
  if (!valveResult.ok) {
    logEvent("error", "run_abort_valve_on", {
      run_id: runId,
      verified: valves.map((v, i) => ({
        device_id: v.device_id,
        channel: v.channel,
        ok: valveVerified[i],
      })),
    });
    // Safety close (best effort, with retry). Pump is NOT touched — still off.
    const closed = await ensureDevices(valves, false, 3);
    db.prepare(
      "UPDATE irrigation_runs SET status='failed', finished_at=? WHERE id=?"
    ).run(nowIso(), runId);
    await sendTelegram(
      "warn",
      `Run #${runId} DIBATALKAN — valve gagal ON. Pompa tidak dinyalakan; valve ${
        closed.ok ? "sudah ditutup kembali" : "GAGAL ditutup — CEK MANUAL!"
      }.`
    );
    throw new Error(`Run #${runId} aborted: valves failed to confirm ON`);
  }

  // 2) Wait the configured pump delay (valve travel time — NOT the watering duration).
  await sleep(pumpDelayOn * 1000);

  // 3) Start pump(s) and CONFIRM on (set+verify with retry). If the pump can't
  //    be confirmed, ABORT: turn the pump off, close the valves, mark failed.
  const pumpResult = await ensureDevices(pumps, true, 3);
  const pumpVerified = pumpResult.verified;
  if (!pumpResult.ok) {
    logEvent("error", "run_abort_pump_on", {
      run_id: runId,
      verified: pumps.map((p2, i) => ({
        device_id: p2.device_id,
        channel: p2.channel,
        ok: pumpVerified[i],
      })),
    });
    await ensureDevices(pumps, false, 3); // pump off first (deadhead-safe order)
    const closed = await ensureDevices(valves, false, 3);
    db.prepare(
      "UPDATE irrigation_runs SET status='failed', finished_at=? WHERE id=?"
    ).run(nowIso(), runId);
    await sendTelegram(
      "warn",
      `Run #${runId} DIBATALKAN — pompa gagal ON. Pompa dimatikan; valve ${
        closed.ok ? "sudah ditutup" : "GAGAL ditutup — CEK MANUAL!"
      }.`
    );
    throw new Error(`Run #${runId} aborted: pump failed to confirm ON`);
  }

  // 4) Record channel_state for every active channel — the watchdog's shutoff source.
  const insCs = db.prepare(
    `INSERT INTO channel_state
       (run_id, device_id, channel, role, state, on_at, expected_off_at, verified, last_checked_at)
     VALUES (?, ?, ?, ?, 'on', ?, ?, ?, ?)`
  );
  valves.forEach((v, i) =>
    insCs.run(runId, v.device_id, v.channel, "valve", startedAt, expectedOff, valveVerified[i] ? 1 : 0, nowIso())
  );
  pumps.forEach((p2, i) =>
    insCs.run(runId, p2.device_id, p2.channel, "pump", startedAt, expectedOff, pumpVerified[i] ? 1 : 0, nowIso())
  );

  // Reaching here means every valve AND pump was confirmed on (else we aborted
  // above), so the run is fully verified.
  const et0s = p.et0 != null ? p.et0.toFixed(3) : "-";
  const soils = p.soil_avg != null ? p.soil_avg.toFixed(1) : "-";
  await sendTelegram(
    "info",
    `Penyiraman dimulai (run #${runId}) — durasi ${duration} mnt, ET0 ${et0s} mm/jam, soil ${soils}%. Mati otomatis ~${toWIB(expectedOff)}.`
  );

  return {
    run_id: runId,
    duration_minutes: duration,
    clamped_to_safety: clamped,
    started_at: startedAt,
    expected_off_at: expectedOff,
    verified: true,
    dryRun: isDryRun(),
  };
}

// --- OFF sequence ------------------------------------------------------------
export async function stopIrrigation(runId: number) {
  const db = getDb();
  const run = db
    .prepare("SELECT id, started_at, status FROM irrigation_runs WHERE id = ?")
    .get(runId) as RunRow | undefined;

  if (!run) return { run_id: runId, notFound: true as const };

  if (stopping.has(runId)) {
    return { run_id: runId, alreadyStopping: true as const };
  }
  if (run.status !== "running") {
    return { run_id: runId, status: run.status, alreadyStopped: true as const };
  }

  stopping.add(runId);
  try {
    const channels = db
      .prepare("SELECT id, device_id, channel, role FROM channel_state WHERE run_id = ?")
      .all(runId) as ChannelStateRow[];
    const valves = channels.filter((c) => c.role === "valve");
    const pumps = channels.filter((c) => c.role === "pump");
    const pumpDelayOff = num(getSetting("pump_delay_off_seconds"), 0);

    const upd = db.prepare(
      "UPDATE channel_state SET state=?, verified=?, last_checked_at=? WHERE id=?"
    );

    // 1) Pump(s) off FIRST, and CONFIRM off (set+verify with retry). The valves
    //    must NOT be closed until the pump is confirmed off — closing them
    //    against a running pump would deadhead it. If the pump can't be
    //    confirmed off, leave the valves open, alarm hard, and keep the run
    //    'running' so the watchdog keeps retrying the stop.
    const pumpResult = await ensureDevices(pumps, false, 3);
    const pumpV = pumpResult.verified;
    pumps.forEach((p, i) =>
      upd.run(pumpV[i] ? "off" : "on", pumpV[i] ? 1 : 0, nowIso(), p.id)
    );
    if (!pumpResult.ok) {
      logEvent("error", "stop_pump_off_failed", {
        run_id: runId,
        verified: pumps.map((p, i) => ({
          device_id: p.device_id,
          channel: p.channel,
          ok: pumpV[i],
        })),
      });
      await sendTelegram(
        "warn",
        `Run #${runId}: pompa GAGAL dimatikan setelah retry — valve TIDAK ditutup (risiko deadhead). CEK MANUAL SEGERA! Watchdog akan terus mencoba.`
      );
      throw new Error(
        `Run #${runId}: pump failed to confirm OFF; valves left open`
      );
    }

    // 2) Optional configured delay.
    if (pumpDelayOff > 0) await sleep(pumpDelayOff * 1000);

    // 3) Valves off (channels on the same device switch together in one call),
    //    confirmed with retry.
    const valveResult = await ensureDevices(valves, false, 3);
    const valveV = valveResult.verified;
    valves.forEach((v, i) =>
      upd.run(valveV[i] ? "off" : "on", valveV[i] ? 1 : 0, nowIso(), v.id)
    );

    // If any valve couldn't be confirmed off, keep the run 'running' (do NOT mark
    // completed) so the watchdog keeps retrying the stop. The pump is already
    // confirmed off here, so re-closing valves on the next attempt is safe.
    if (!valveResult.ok) {
      logEvent("warn", "stop_valve_off_failed", {
        run_id: runId,
        verified: valves.map((v, i) => ({
          device_id: v.device_id,
          channel: v.channel,
          ok: valveV[i],
        })),
      });
      await sendTelegram(
        "warn",
        `Run #${runId}: pompa sudah mati tapi valve GAGAL ditutup setelah retry — periksa device. Watchdog akan terus mencoba.`
      );
      throw new Error(`Run #${runId}: valves failed to confirm OFF`);
    }

    db.prepare("UPDATE irrigation_runs SET status='completed', finished_at=? WHERE id=?").run(
      nowIso(),
      runId
    );

    const actualMin = run.started_at
      ? (Date.now() - Date.parse(run.started_at)) / 60_000
      : null;
    logEvent("info", "run_stop", { run_id: runId, verified: true, actual_minutes: actualMin });
    await sendTelegram(
      "info",
      `Penyiraman selesai (run #${runId})${
        actualMin != null ? ` — durasi aktual ~${actualMin.toFixed(1)} mnt` : ""
      }.`
    );

    return { run_id: runId, status: "completed" as const, verified: true, dryRun: isDryRun() };
  } finally {
    stopping.delete(runId);
  }
}
