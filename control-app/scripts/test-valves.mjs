// Standalone pre-flight test for the multi-channel (combined) valve write.
//
// Proves that eWeLink accepts BOTH channels of the valve device in ONE request
// with a fresh nonce/ts — i.e. no "401 wrong account or password" and no
// per-channel clobber — WITHOUT touching the pump or running a full irrigation.
//
// Usage (run from control-app/):
//   node scripts/test-valves.mjs status            # just read current state
//   node scripts/test-valves.mjs on                # both valve channels ON
//   node scripts/test-valves.mjs off               # both valve channels OFF
//   node scripts/test-valves.mjs off 10023eaccf 1,2  # explicit device + channels
//
// Respects nothing about EWELINK_DRY_RUN — this ALWAYS hits real hardware, so
// only run it when it is safe for the valves to move.
import ewelink from "ewelink-api";
import { loadEnv } from "./util.mjs";

loadEnv();

const action = (process.argv[2] || "status").toLowerCase();
const deviceId = process.argv[3] || "10023eaccf";
const channels = (process.argv[4] || "1,2")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n));

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k} (check <repo-root>/.env)`);
  return v;
};

const conn = new ewelink({
  email: need("EWELINK_EMAIL"),
  password: need("EWELINK_PASSWORD"),
  region: process.env.EWELINK_REGION || "as",
  APP_ID: need("EWELINK_APP_ID"),
  APP_SECRET: need("EWELINK_APP_SECRET"),
});

const freshNonce = () => Math.random().toString(36).slice(2, 12);
const freshTs = () => Math.floor(Date.now() / 1000);

function show(device) {
  const switches = device?.params?.switches;
  if (Array.isArray(switches)) {
    console.log(
      "  channels:",
      switches.map((s, i) => `ch${i + 1}=${s.switch}`).join("  ")
    );
  } else {
    console.log("  switch:", device?.params?.switch);
  }
}

async function readDevice() {
  const device = await conn.getDevice(deviceId);
  if (device?.error) {
    throw new Error(`getDevice failed: ${device.error} ${device.msg || ""}`);
  }
  return device;
}

const main = async () => {
  console.log(`Device ${deviceId} — reading current state...`);
  const device = await readDevice();
  console.log("BEFORE:");
  show(device);

  if (action === "status") return;

  const state = action === "on" ? "on" : "off";
  const switches = device?.params?.switches;
  if (!Array.isArray(switches)) {
    throw new Error(`${deviceId} is not a multi-channel device`);
  }

  // Combined: override the requested channels, keep the rest, send ONE request.
  const wanted = new Set(channels.map((c) => c - 1));
  const next = switches.map((s, i) =>
    wanted.has(i) ? { ...s, switch: state } : s
  );

  console.log(`\nSending COMBINED write: ch${channels.join("+")} -> ${state}`);
  const res = await conn.makeRequest({
    method: "post",
    uri: "/user/device/status",
    body: {
      deviceid: deviceId,
      params: { switches: next },
      appid: process.env.EWELINK_APP_ID,
      nonce: freshNonce(),
      ts: freshTs(),
      version: 8,
    },
  });
  console.log("response:", JSON.stringify(res));
  if (res?.error) {
    throw new Error(`combined write failed: ${res.error} ${res.msg || ""}`);
  }

  // Re-read after a short settle to prove BOTH channels landed.
  await new Promise((r) => setTimeout(r, 1500));
  console.log("\nAFTER:");
  show(await readDevice());
};

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
