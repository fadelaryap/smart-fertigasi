// Shared handler for the open /api/device/on and /api/device/off endpoints.
// setPowerState already writes an event_log entry; here we add verification.
import { NextRequest, NextResponse } from "next/server";
import { setPowerState, verifyState, isDryRun, type PowerState } from "./ewelink";

export async function handleSetPower(req: NextRequest, on: boolean) {
  const body = (await req.json().catch(() => ({}))) as {
    device_id?: unknown;
    channel?: unknown;
  };
  const deviceId = body.device_id;
  const channel = body.channel;

  if (typeof deviceId !== "string" || !Number.isInteger(channel)) {
    return NextResponse.json(
      { error: "Body must include device_id (string) and channel (integer)" },
      { status: 400 }
    );
  }

  const expected: PowerState = on ? "on" : "off";
  try {
    await setPowerState(deviceId, channel as number, on);
    const verified = await verifyState(deviceId, channel as number, expected);
    return NextResponse.json({
      device_id: deviceId,
      channel,
      state: expected,
      verified,
      dryRun: isDryRun(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
