// Seed default data. Idempotent: existing rows are preserved (INSERT OR IGNORE /
// "only when empty"), so re-running never clobbers values you edited in the UI.
import crypto from "node:crypto";
import { loadEnv, openDb } from "./util.mjs";

loadEnv();
const db = openDb();

// --- Password hashing (scrypt) -----------------------------------------------
// Format kept identical to control-app/lib/auth.ts (M9): scrypt$<saltHex>$<hashHex>.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// --- 1. Fuzzy config (defaults mirror the Python FuzzyConfig dataclass) -------
db.prepare(
  `INSERT OR IGNORE INTO fuzzy_config
     (id, sdmin, snmin, sdmax, swmin, snmax, swmax,
      elmin, emmin, elmax, ehmin, emmax, ehmax,
      os, om, ol, output_max)
   VALUES (1, 16, 20, 24, 25, 28, 30,
           0, 0.1, 0.25, 0.35, 0.6, 1.0,
           5, 15, 30, 60)`
).run();

// --- 2. Device config (2 valves on Device 1, 1 pump on Device 2) -------------
// device_id are placeholders — edit them from the UI once you know the real IDs.
const deviceCount = db.prepare("SELECT COUNT(*) c FROM device_config").get().c;
if (deviceCount === 0) {
  const ins = db.prepare(
    "INSERT INTO device_config (role, device_id, channel, label, enabled) VALUES (?,?,?,?,1)"
  );
  ins.run("valve", "DEVICE1_ID", 1, "Valve 1");
  ins.run("valve", "DEVICE1_ID", 2, "Valve 2");
  ins.run("pump", "DEVICE2_ID", 1, "Pompa");
}

// --- 3. Schedules (07:00 & 16:00 Asia/Jakarta) -------------------------------
const schedCount = db.prepare("SELECT COUNT(*) c FROM schedules").get().c;
if (schedCount === 0) {
  const ins = db.prepare(
    "INSERT INTO schedules (time, enabled, timezone) VALUES (?, 1, 'Asia/Jakarta')"
  );
  ins.run("07:00");
  ins.run("16:00");
}

// --- 4. Settings (single-value; secrets like eWeLink creds stay in .env) -----
const settingsDefaults = {
  system_enabled: "1",
  pump_delay_on_seconds: "7",
  pump_delay_off_seconds: "0",
  safety_max_minutes: "60",
  agrihub_base_url: process.env.AGRIHUB_BASE_URL || "",
  // agrihub TELEMETRY device ids (NOT eWeLink device ids).
  agrihub_weather_device_id: process.env.AGRIHUB_WEATHER_DEVICE_ID || "",
  agrihub_soil_device_id: process.env.AGRIHUB_SOIL_DEVICE_ID || "",
  // channel mapping (set from the Settings UI dropdowns).
  weather_temp_channel: "s1",
  weather_rh_channel: "s2",
  weather_wind_channel: "s3",
  weather_radiation_channel: "s4",
  soil_channels: "s1,s2,s3",
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || "",
  telegram_chat_id: process.env.TELEGRAM_CHAT_ID || "",
};
const insSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
);
for (const [k, v] of Object.entries(settingsDefaults)) insSetting.run(k, v);

// --- 5. Admin user -----------------------------------------------------------
const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "";
let userMsg;
if (!adminPass) {
  userMsg = `⚠️  ADMIN_PASSWORD kosong di .env — user admin TIDAK dibuat. Isi ADMIN_PASSWORD lalu jalankan ulang seed.`;
} else {
  const existing = db
    .prepare("SELECT 1 FROM users WHERE username = ?")
    .get(adminUser);
  if (existing) {
    userMsg = `ℹ️  User '${adminUser}' sudah ada — dilewati.`;
  } else {
    db.prepare(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)"
    ).run(adminUser, hashPassword(adminPass));
    userMsg = `✅ User admin '${adminUser}' dibuat.`;
  }
}

console.log("✅ Seed selesai.");
console.log(`   fuzzy_config: 1 baris`);
console.log(`   device_config: ${db.prepare("SELECT COUNT(*) c FROM device_config").get().c} baris`);
console.log(`   schedules: ${db.prepare("SELECT time FROM schedules ORDER BY time").all().map((r) => r.time).join(", ")}`);
console.log(`   settings: ${db.prepare("SELECT COUNT(*) c FROM settings").get().c} key`);
console.log(`   ${userMsg}`);
db.close();
