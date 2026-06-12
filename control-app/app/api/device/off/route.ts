import { NextRequest } from "next/server";
import { handleSetPower } from "@/lib/deviceApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/off { device_id, channel } — setDevicePowerState OFF. Open endpoint.
export const POST = (req: NextRequest) => handleSetPower(req, false);
