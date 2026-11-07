import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaylistEditor } from "./playlist-editor";

export const metadata: Metadata = { title: "Edit playlist | KDCC Darpan" };

export default function PlaylistPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <PlaylistEditor />
      </Suspense>
    </div>
  );
}
