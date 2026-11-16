"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { useScreenUpdates } from "@/lib/live-updates";

/** At most one refresh this often: 100 TVs checking in should not re-render the page 100 times. */
const MIN_GAP_MS = 3_000;

/** Re-renders a server-rendered page (such as Overview) when screens come online, go away or change. */
export function LiveRefresh() {
  const router = useRouter();
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (pending.current) return;
    const wait = Math.max(0, last.current + MIN_GAP_MS - Date.now());
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  }, [router]);

  useScreenUpdates(refresh);
  return null;
}
