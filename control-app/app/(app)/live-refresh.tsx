"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const eventSource = new EventSource("/api/sse");

    eventSource.onmessage = (event) => {
      if (event.data === "refresh") {
        // 1. Refresh Server Components (page.tsx)
        router.refresh();
        
        // 2. Dispatch custom event for Client Components (e.g. charts) to refetch
        window.dispatchEvent(new Event("dashboard-refresh"));
      }
    };

    return () => {
      eventSource.close();
    };
  }, [router]);

  return null;
}
