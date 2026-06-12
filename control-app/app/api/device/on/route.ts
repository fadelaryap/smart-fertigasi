import { NextRequest } from "next/server";
import { handleSetPower } from "@/lib/deviceApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/device/on { device_id, channel } — setDevicePowerState ON. Open endpoint.
export const POST = (req: NextRequest) => handleSetPower(req, true);
