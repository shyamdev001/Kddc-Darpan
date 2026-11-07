import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = { title: "Schedules | KDCC Darpan" };

export default function SchedulesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Schedules" description="When screens are on, and playlists that play only at certain times." />
      <ScheduleView />
    </div>
  );
}
