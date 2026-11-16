"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { DASHBOARD_NAMESPACE, DASHBOARD_SOCKET_PATH, SCREENS_CHANGED_EVENT, type ScreensChangedPayload } from "@darpan/shared";

/*
 * One live connection per browser tab, shared by every page that wants screen updates.
 * The server only says which screens changed; each page reloads its own data, so the usual
 * API checks (role, region) still decide what anyone sees.
 */

type Listener = (screenIds: string[]) => void;
const listeners = new Set<Listener>();
const statusListeners = new Set<(live: boolean) => void>();
let socket: Socket | null = null;
let live = false;

function setLive(v: boolean) {
  live = v;
  statusListeners.forEach((l) => l(v));
}

function start() {
  if (socket) return;
  socket = io(DASHBOARD_NAMESPACE, { path: DASHBOARD_SOCKET_PATH, addTrailingSlash: false, withCredentials: true });
  socket.on(SCREENS_CHANGED_EVENT, (p: ScreensChangedPayload) => listeners.forEach((l) => l(p.screenIds ?? [])));
  socket.on("connect", () => {
    setLive(true);
    // Anything may have changed while we were cut off: everyone reloads once.
    listeners.forEach((l) => l([]));
  });
  socket.on("disconnect", () => setLive(false));
  socket.on("connect_error", () => setLive(false));
}

function stop() {
  if (listeners.size || statusListeners.size || !socket) return;
  socket.disconnect();
  socket = null;
  setLive(false);
}

/**
 * Calls `reload` whenever a screen changes (an empty list means "could be any"), and every
 * `fallbackMs` as a safety net. `only` limits it to one screen. Overlapping reloads are merged:
 * one runs, and one more follows if anything changed meanwhile.
 */
export function useScreenUpdates(reload: () => Promise<unknown> | void, opts: { only?: string; fallbackMs?: number } = {}) {
  const { only, fallbackMs = 60_000 } = opts;
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    let running = false;
    let again = false;
    const run = async () => {
      if (document.hidden) {
        again = true; // catch up when the tab is shown
        return;
      }
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        await reloadRef.current();
      } catch {
        /* the page shows its own error */
      } finally {
        running = false;
        if (again) {
          again = false;
          void run();
        }
      }
    };
    const onChange: Listener = (ids) => {
      if (!only || ids.length === 0 || ids.includes(only)) void run();
    };
    const onVisible = () => {
      if (!document.hidden && again) {
        again = false;
        void run();
      }
    };

    listeners.add(onChange);
    start();
    const timer = setInterval(() => void run(), fallbackMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(onChange);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, [only, fallbackMs]);
}

/** Whether the live connection is up, for a small "Live" sign. */
export function useLiveStatus(): boolean {
  return useSyncExternalStore(subscribeStatus, () => live, () => false);
}

function subscribeStatus(onChange: () => void) {
  statusListeners.add(onChange);
  start();
  return () => {
    statusListeners.delete(onChange);
    stop();
  };
}
