import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Minta browser reconnect otomatis jika putus
  writer.write(encoder.encode("retry: 5000\n\n"));

  const db = getDb();
  let lastEventId = -1;

  const intervalId = setInterval(() => {
    try {
      // Proxy termudah untuk mendeteksi perubahan: event_log bertambah
      const row = db.prepare("SELECT MAX(id) as maxId FROM event_log").get() as { maxId: number | null };
      const currentMax = row?.maxId || 0;
      
      if (lastEventId === -1) {
         lastEventId = currentMax;
      } else if (currentMax > lastEventId) {
         lastEventId = currentMax;
         // Dorong event refresh ke klien
         writer.write(encoder.encode(`data: refresh\n\n`));
      }
      
      // Ping untuk menjaga koneksi tetap hidup
      writer.write(encoder.encode(`:\n\n`)); 
    } catch (e) {
      clearInterval(intervalId);
      writer.close().catch(() => {});
    }
  }, 2000); // Polling SQLite tiap 2 detik (sangat ringan)

  req.signal.addEventListener("abort", () => {
    clearInterval(intervalId);
    writer.close().catch(() => {});
  });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
