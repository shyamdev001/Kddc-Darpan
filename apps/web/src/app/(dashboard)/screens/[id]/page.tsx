import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenDetailView } from "./screen-detail";

export const metadata: Metadata = { title: "Screen | KDCC Darpan" };

export default function ScreenPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <ScreenDetailView />
      </Suspense>
    </div>
  );
}
