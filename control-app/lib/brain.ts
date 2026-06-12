// Spawn the Python brain (fetch sensors -> fuzzy -> decide -> POST /api/run).
// Shared by the scheduler (triggered_by='schedule') and /api/run-now ('manual').
import path from "node:path";
import { spawn } from "node:child_process";
import { logEvent } from "./db";
import { optionalEnv } from "./env";

export function spawnBrain(triggeredBy: "schedule" | "manual"): void {
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
  child.on("error", (err) =>
    logEvent("error", "brain_spawn_failed", {
      error: String(err),
      pythonBin,
      triggeredBy,
    })
  );
  child.on("close", (code) =>
    logEvent(code === 0 ? "info" : "error", "brain_exit", {
      code,
      triggeredBy,
      output: out.slice(-2000),
    })
  );

  logEvent("info", "brain_spawned", { triggeredBy, pythonBin });
}
