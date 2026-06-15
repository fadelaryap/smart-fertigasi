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
import { setPowerState, verifyState, isDryRun } from "./ewelink";
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

  // // 1) Open BOTH valves together.
  // await Promise.all(valves.map((v) => setPowerState(v.device_id, v.channel, true)));

  for (let i = 0; i < valves.length; i++) {
    const v = valves[i];
  
    await setPowerState(v.device_id, v.channel, true);
  
    if (i < valves.length - 1) {
      await sleep(3000);
    }
  }
  const valveVerified = await Promise.all(
    valves.map((v) => verifyState(v.device_id, v.channel, "on"))
  );

  // 2) Wait the configured pump delay (explicit 7s — NOT the watering duration).
  await sleep(pumpDelayOn * 1000);

  // 3) Start pump(s).
  await Promise.all(pumps.map((p2) => setPowerState(p2.device_id, p2.channel, true)));
  const pumpVerified = await Promise.all(
    pumps.map((p2) => verifyState(p2.device_id, p2.channel, "on"))
  );

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

  const allVerified = [...valveVerified, ...pumpVerified].every(Boolean);
  if (!allVerified) {
    logEvent("warn", "run_verify_mismatch", { run_id: runId, valveVerified, pumpVerified });
    await sendTelegram("warn", `Verifikasi ON gagal di run #${runId} — periksa device.`);
  }

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
    verified: allVerified,
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

    // 1) Pump(s) off FIRST.
    await Promise.all(pumps.map((p) => setPowerState(p.device_id, p.channel, false)));
    const pumpV = await Promise.all(
      pumps.map((p) => verifyState(p.device_id, p.channel, "off"))
    );

    // 2) Optional configured delay.
    if (pumpDelayOff > 0) await sleep(pumpDelayOff * 1000);

    // 3) Valves off.
    // await Promise.all(valves.map((v) => setPowerState(v.device_id, v.channel, false)));
    for (let i = 0; i < valves.length; i++) {
      const v = valves[i];
    
      await setPowerState(v.device_id, v.channel, false);
    
      if (i < valves.length - 1) {
        await sleep(3000);
      }
    }
    const valveV = await Promise.all(
      valves.map((v) => verifyState(v.device_id, v.channel, "off"))
    );

    const upd = db.prepare(
      "UPDATE channel_state SET state='off', verified=?, last_checked_at=? WHERE id=?"
    );
    pumps.forEach((p, i) => upd.run(pumpV[i] ? 1 : 0, nowIso(), p.id));
    valves.forEach((v, i) => upd.run(valveV[i] ? 1 : 0, nowIso(), v.id));

    db.prepare("UPDATE irrigation_runs SET status='completed', finished_at=? WHERE id=?").run(
      nowIso(),
      runId
    );

    const allV = [...pumpV, ...valveV].every(Boolean);
    if (!allV) {
      logEvent("warn", "stop_verify_mismatch", { run_id: runId, pumpV, valveV });
      await sendTelegram("warn", `Verifikasi OFF gagal di run #${runId} — periksa device.`);
    }

    const actualMin = run.started_at
      ? (Date.now() - Date.parse(run.started_at)) / 60_000
      : null;
    logEvent("info", "run_stop", { run_id: runId, verified: allV, actual_minutes: actualMin });
    await sendTelegram(
      "info",
      `Penyiraman selesai (run #${runId})${
        actualMin != null ? ` — durasi aktual ~${actualMin.toFixed(1)} mnt` : ""
      }.`
    );

    return { run_id: runId, status: "completed" as const, verified: allV, dryRun: isDryRun() };
  } finally {
    stopping.delete(runId);
  }
}
