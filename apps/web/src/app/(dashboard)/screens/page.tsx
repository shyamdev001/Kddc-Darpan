import { MonitorPlay } from "lucide-react";
import { EmptyState } from "../empty-state";
import { PageHeader } from "../page-header";

export default function ScreensPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Screens" description="Every branch TV, whether it is online, and what it is playing." />
      <EmptyState icon={MonitorPlay} title="No screens paired yet" note="Pairing arrives with the TV app.">
        When the Darpan app first starts on a TV it shows a 6-digit code. Enter that code here and pick
        the branch, and the TV joins the network.
      </EmptyState>
    </div>
  );
}
