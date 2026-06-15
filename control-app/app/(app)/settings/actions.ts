"use server";

import { revalidatePath } from "next/cache";
import { setSetting, getDb } from "@/lib/db";

// Scalar settings editable from the UI. eWeLink creds are intentionally NOT here —
// they live only in .env. (Local const — a "use server" file may only EXPORT
// async functions.) NOTE: agrihub_*_device_id are agrihub TELEMETRY device ids,
// NOT the eWeLink/Sonoff device ids (those live in device_config).
const SCALAR_KEYS = [
  "agrihub_base_url",
  "agrihub_weather_device_id",
  "agrihub_soil_device_id",
  "telegram_bot_token",
  "telegram_chat_id",
  "pump_delay_on_seconds",
  "pump_delay_off_seconds",
  "safety_max_minutes",
  "weather_temp_channel",
  "weather_rh_channel",
  "weather_wind_channel",
  "weather_radiation_channel",
  "ewelink_dry_run",
];

export async function updateSettings(formData: FormData) {
  for (const key of SCALAR_KEYS) {
    const v = formData.get(key);
    if (v !== null) setSetting(key, String(v).trim());
  }
  // Soil channels: dynamic multi-select (checkboxes) -> comma-joined list.
  const soil = formData
    .getAll("soil_channels")
    .map((c) => String(c))
    .filter(Boolean);
  setSetting("soil_channels", soil.join(","));
  revalidatePath("/settings");
}

export async function clearEventLogs() {
  getDb().prepare("DELETE FROM event_log").run();
  revalidatePath("/logs");
  revalidatePath("/settings");
}
