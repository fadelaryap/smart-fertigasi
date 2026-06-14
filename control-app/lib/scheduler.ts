// Internal dynamic scheduler (Control App side). Reads watering times from the
// `schedules` table and registers one node-cron job per enabled row. When the UI
// changes schedules, call reloadSchedules() to re-register.
//
// The OS-cron watchdog stays SEPARATE and independent — this scheduler only
// TRIGGERS watering; shutoff is driven by expected_off_at + watchdog.
import cron, { type ScheduledTask } from "node-cron";
import { getDb, logEvent, isSystemEnabled } from "./db";
import { spawnBrain } from "./brain";

interface ScheduleRow {
  id: number;
  time: string;
  enabled: number;
  timezone: string;
}

// Persist task handles + started flag across HMR / repeated instrumentation runs.
const g = globalThis as unknown as {
  __fertSchedulerTasks?: ScheduledTask[];
  __fertSchedulerStarted?: boolean;
  __fertMaintenanceStarted?: boolean;
};

export interface SchedulerStatus {
  count: number;
  jobs: { id: number; time: string; timezone: string }[];
}

export function reloadSchedules(): SchedulerStatus {
  // Stop and clear any previously registered jobs.
  for (const t of g.__fertSchedulerTasks ?? []) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
  g.__fertSchedulerTasks = [];

  const rows = getDb()
    .prepare("SELECT id, time, enabled, timezone FROM schedules WHERE enabled = 1 ORDER BY time")
    .all() as ScheduleRow[];

  const jobs: SchedulerStatus["jobs"] = [];
  for (const r of rows) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(r.time.trim());
    const hour = m ? Number(m[1]) : NaN;
    const minute = m ? Number(m[2]) : NaN;
    if (!m || hour > 23 || minute > 59) {
      logEvent("warn", "schedule_invalid_time", { id: r.id, time: r.time });
      continue;
    }
    const expr = `${minute} ${hour} * * *`;
    const tz = r.timezone || "Asia/Jakarta";
    if (!cron.validate(expr)) {
      logEvent("warn", "schedule_invalid_cron", { id: r.id, expr });
      continue;
    }
    const task = cron.schedule(
      expr,
      () => {
        logEvent("info", "schedule_fired", { id: r.id, time: r.time, tz });
        if (!isSystemEnabled()) {
          logEvent("warn", "system_disabled_skip", { id: r.id, time: r.time });
          return;
        }
        spawnBrain("schedule");
      },
      { timezone: tz }
    );
    g.__fertSchedulerTasks.push(task);
    jobs.push({ id: r.id, time: r.time, timezone: tz });
  }

  logEvent("info", "scheduler_reloaded", { count: jobs.length, jobs });
  return { count: jobs.length, jobs };
}

export function startScheduler(): void {
  if (g.__fertSchedulerStarted) return;
  g.__fertSchedulerStarted = true;
  const status = reloadSchedules();
  logEvent("info", "scheduler_started", { count: status.count });

  // Start daily maintenance job
  if (!g.__fertMaintenanceStarted) {
    g.__fertMaintenanceStarted = true;
    cron.schedule("0 2 * * *", () => {
      try {
        const info = getDb().prepare("DELETE FROM event_log WHERE ts < datetime('now', '-30 days')").run();
        console.log(`[maintenance] Deleted ${info.changes} old event_log entries.`);
      } catch (err) {
        console.error("[maintenance] Failed to prune event_log:", err);
      }
    });
  }
}
