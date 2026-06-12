"use server";

import { revalidatePath } from "next/cache";
import { spawnBrain } from "@/lib/brain";
import { stopIrrigation } from "@/lib/irrigation";
import { getSetting, setSetting, logEvent } from "@/lib/db";

export async function runNowAction() {
  spawnBrain("manual");
  revalidatePath("/");
}

export async function toggleSystemAction() {
  const enabled = getSetting("system_enabled") !== "0";
  setSetting("system_enabled", enabled ? "0" : "1");
  logEvent("warn", enabled ? "system_disabled" : "system_enabled", {});
  revalidatePath("/");
}

export async function stopRunAction(formData: FormData) {
  const runId = Number(formData.get("run_id"));
  if (Number.isInteger(runId)) await stopIrrigation(runId);
  revalidatePath("/");
}
