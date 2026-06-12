"use server";

import path from "node:path";
import { spawn } from "node:child_process";
import { revalidatePath } from "next/cache";
import { setSetting, logEvent } from "@/lib/db";
import { testConnection } from "@/lib/ewelink";
import { optionalEnv } from "@/lib/env";
import { nowIso } from "@/lib/time";

// Test eWeLink connectivity (real getDevices, read-only).
export async function testEwelinkAction() {
  const res = await testConnection();
  setSetting("diag_ewelink_last", JSON.stringify({ ...res, ts: nowIso() }));
  logEvent(res.ok ? "info" : "warn", "diag_ewelink", res.ok ? { count: res.count } : { error: res.error });
  revalidatePath("/diagnostics");
}

// Test agrihub fetch + mapping (+ fuzzy) by running `brain.py --test` which
// prints one JSON line. No watering happens.
export async function testAgrihubAction() {
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    const brainDir = path.join(path.resolve(process.cwd(), ".."), "brain");
    const child = spawn(optionalEnv("PYTHON_BIN", "python"), ["brain.py", "--test"], {
      cwd: brainDir,
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, error: String(e) }));
    child.on("close", () => {
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, error: `output tak terbaca: ${(out || err).slice(-300)}` });
      }
    });
  });
  setSetting("diag_agrihub_last", JSON.stringify({ ...result, ts: nowIso() }));
  logEvent(result.ok ? "info" : "warn", "diag_agrihub", result.ok ? {} : { error: result.error });
  revalidatePath("/diagnostics");
}
