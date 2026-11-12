import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { ActivityView } from "./activity-view";

export const metadata: Metadata = { title: "Activity | KDCC Darpan" };

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Activity" description="Who changed what, and when. Kept for every change that affects screens, and every sign-in." />
      <ActivityView />
    </div>
  );
}
