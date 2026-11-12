import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { BroadcastView } from "./broadcast-view";

export const metadata: Metadata = { title: "Broadcast | KDCC Darpan" };

export default function BroadcastPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Broadcast"
        description="Put an urgent message, a poster or video, or a live stream on screens right away. The playlists carry on when it ends."
      />
      <BroadcastView />
    </div>
  );
}
