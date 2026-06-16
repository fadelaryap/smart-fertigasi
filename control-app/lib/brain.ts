// Spawn the Python brain (fetch sensors -> fuzzy -> decide -> POST /api/run).
// Shared by the scheduler (triggered_by='schedule') and /api/run-now ('manual').
import path from "node:path";
import { spawn } from "node:child_process";
import { logEvent, getSetting, setSetting } from "./db";
import { optionalEnv } from "./env";

export function spawnBrain(triggeredBy: "schedule" | "manual"): void {
  const isRunning = getSetting("brain_running");
  if (isRunning) {
    const ageMs = Date.now() - new Date(isRunning).getTime();
    if (ageMs < 60000) {
      logEvent("warn", "brain_spawn_skipped", { reason: "already_running", triggeredBy });
      return;
    }
  }

  setSetting("brain_running", new Date().toISOString());

  const repoRoot = path.resolve(process.cwd(), "..");
  const brainDir = path.join(repoRoot, "brain");
  // On the VPS point PYTHON_BIN at the venv python; defaults to "python" in dev.
  const pythonBin = optionalEnv("PYTHON_BIN", "python");

  const child = spawn(pythonBin, ["brain.py", triggeredBy], {
    cwd: brainDir,
    env: process.env,
  });

  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));
  child.on("error", (err) => {
    setSetting("brain_running", "");
    logEvent("error", "brain_spawn_failed", {
      error: String(err),
      pythonBin,
      triggeredBy,
    });
  });
  child.on("close", (code) => {
    setSetting("brain_running", "");
    logEvent(code === 0 ? "info" : "error", "brain_exit", {
      code,
      triggeredBy,
      output: out.slice(-2000),
    });
  });

  logEvent("info", "brain_spawned", { triggeredBy, pythonBin });
}
