import { NextRequest, NextResponse } from "next/server";
import { getPowerState, isDryRun } from "@/lib/ewelink";
import { logEvent } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/device/status?device_id=&channel= — getDevicePowerState. Open endpoint.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get("device_id");
  const channelRaw = searchParams.get("channel");

  if (!deviceId || channelRaw === null) {
    return NextResponse.json(
      { error: "Missing required query params: device_id, channel" },
      { status: 400 }
    );
  }
  const channel = Number(channelRaw);
  if (!Number.isInteger(channel)) {
    return NextResponse.json({ error: "channel must be an integer" }, { status: 400 });
  }

  try {
    const state = await getPowerState(deviceId, channel);
    return NextResponse.json({ device_id: deviceId, channel, state, dryRun: isDryRun() });
  } catch (err) {
    logEvent("error", "api_device_status_failed", {
      device_id: deviceId,
      channel,
      error: String(err),
    });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
