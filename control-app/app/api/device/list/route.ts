import { NextResponse } from "next/server";
import { listDevices, isDryRun } from "@/lib/ewelink";
import { logEvent } from "@/lib/db";

// Native modules (better-sqlite3, ewelink-api) require the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/device/list — list devices from eWeLink (getDevices). Open endpoint.
export async function GET() {
  try {
    const devices = await listDevices();
    return NextResponse.json({
      dryRun: isDryRun(),
      count: devices.length,
      devices,
    });
  } catch (err) {
    logEvent("error", "api_device_list_failed", { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
