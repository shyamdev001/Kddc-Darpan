"use client";

import { useCallback, useRef, useState } from "react";
import { goToSignInExpired } from "@/lib/session-expired";
import type { UploadResult } from "@darpan/shared";

export type UploadState =
  | { phase: "queued" }
  | { phase: "uploading"; progress: number }
  | { phase: "done" }
  | { phase: "duplicate"; existingName: string }
  | { phase: "rejected"; reason: string };

export interface UploadEntry {
  key: string;
  name: string;
  size: number;
  state: UploadState;
}

const PARALLEL = 3;
const IMAGE_MAX = 30 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

/** Checks the browser can catch before spending time on an upload. The server checks again. */
function precheck(file: File): string | null {
  if (IMAGE_EXT.test(file.name)) return file.size > IMAGE_MAX ? "Images can be up to 30 MB." : null;
  if (VIDEO_EXT.test(file.name)) return file.size > VIDEO_MAX ? "Videos can be up to 500 MB." : null;
  return "Only JPG, PNG, WebP images and MP4, MOV, M4V, WebM videos can be uploaded.";
}

/** One request per file so each gets its own progress bar (fetch cannot report upload progress). */
function send(file: File, onProgress: (p: number) => void): Promise<{ status: number; body: UploadResult | { message?: string } | null }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: null });
    const form = new FormData();
    form.append("files", file, file.name);
    xhr.send(form);
  });
}

export function useUploads(onUploaded: () => void) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const active = useRef(0);

  const patch = useCallback((key: string, state: UploadState) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, state } : e)));
  }, []);

  const pump = useCallback(function pumpQueue() {
    while (active.current < PARALLEL && queue.current.length) {
      const { key, file } = queue.current.shift()!;
      active.current++;
      patch(key, { phase: "uploading", progress: 0 });
      send(file, (p) => patch(key, { phase: "uploading", progress: p })).then(({ status, body }) => {
        active.current--;
        if (status === 201 && body && "created" in body) {
          if (body.created.length) patch(key, { phase: "done" });
          else if (body.duplicates[0]) patch(key, { phase: "duplicate", existingName: body.duplicates[0].existingName });
          else patch(key, { phase: "rejected", reason: body.rejected[0]?.reason ?? "The server did not accept this file." });
          onUploaded();
        } else if (status === 401) {
          goToSignInExpired();
        } else {
          const reason =
            status === 0
              ? "Upload interrupted. Check the connection and try again."
              : status === 403
                ? "Your role cannot upload media."
                : status === 413
                  ? "This file is larger than the server allows."
                  : ((body as { message?: string })?.message ?? `Upload failed (error ${status}).`);
          patch(key, { phase: "rejected", reason });
        }
        pumpQueue();
      });
    }
  }, [onUploaded, patch]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const fresh: UploadEntry[] = [];
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
        const problem = precheck(file);
        fresh.push({ key, name: file.name, size: file.size, state: problem ? { phase: "rejected", reason: problem } : { phase: "queued" } });
        if (!problem) queue.current.push({ key, file });
      }
      setEntries((list) => [...fresh, ...list]);
      pump();
    },
    [pump],
  );

  const clearFinished = useCallback(() => {
    setEntries((list) => list.filter((e) => e.state.phase === "queued" || e.state.phase === "uploading"));
  }, []);

  const busy = entries.some((e) => e.state.phase === "queued" || e.state.phase === "uploading");
  return { entries, add, clearFinished, busy };
}
