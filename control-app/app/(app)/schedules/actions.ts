"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { reloadSchedules } from "@/lib/scheduler";
import { nowIso } from "@/lib/time";

export async function addSchedule(formData: FormData) {
  const time = String(formData.get("time") ?? "").trim();
  if (/^\d{2}:\d{2}$/.test(time)) {
    getDb()
      .prepare(
        "INSERT INTO schedules (time, enabled, timezone, created_at) VALUES (?, 1, 'Asia/Jakarta', ?)"
      )
      .run(time, nowIso());
    reloadSchedules();
  }
  revalidatePath("/schedules");
}

export async function toggleSchedule(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    getDb().prepare("UPDATE schedules SET enabled = 1 - enabled WHERE id = ?").run(id);
    reloadSchedules();
  }
  revalidatePath("/schedules");
}

export async function deleteSchedule(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    getDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
    reloadSchedules();
  }
  revalidatePath("/schedules");
}
