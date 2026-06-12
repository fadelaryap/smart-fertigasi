"use server";

import { revalidatePath } from "next/cache";
import { spawnBrain } from "@/lib/brain";
import { stopIrrigation } from "@/lib/irrigation";

export async function runNowAction() {
  spawnBrain("manual");
  revalidatePath("/");
}

export async function stopRunAction(formData: FormData) {
  const runId = Number(formData.get("run_id"));
  if (Number.isInteger(runId)) await stopIrrigation(runId);
  revalidatePath("/");
}
