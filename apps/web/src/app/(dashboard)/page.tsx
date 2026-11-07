import { Suspense } from "react";
import { OverviewContent } from "./overview-content";
import { PageHeader } from "./page-header";

export default function OverviewPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description="What is playing across the branch network, and what still needs attention."
      />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-muted" />}>
        <OverviewContent />
      </Suspense>
    </div>
  );
}
