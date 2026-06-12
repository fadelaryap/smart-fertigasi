"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

export async function updateDevice(formData: FormData) {
  const id = Number(formData.get("id"));
  const deviceId = String(formData.get("device_id") ?? "").trim();
  const channel = Number(formData.get("channel"));
  const label = String(formData.get("label") ?? "").trim();
  const enabled = formData.get("enabled") ? 1 : 0;

  if (Number.isInteger(id) && deviceId && Number.isInteger(channel)) {
    getDb()
      .prepare(
        "UPDATE device_config SET device_id=?, channel=?, label=?, enabled=? WHERE id=?"
      )
      .run(deviceId, channel, label, enabled, id);
  }
  revalidatePath("/devices");
}
