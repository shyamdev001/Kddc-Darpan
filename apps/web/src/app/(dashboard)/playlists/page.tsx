import { ListVideo } from "lucide-react";
import { EmptyState } from "../empty-state";
import { PageHeader } from "../page-header";

export default function PlaylistsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Playlists" description="The order and timing of what each screen shows." />
      <EmptyState icon={ListVideo} title="No playlists yet" note="Available once media upload is ready.">
        A playlist is a loop of posters and videos. Drag items into order and set how long each poster
        stays on screen, then send it to one TV, a branch, a taluka or the whole network.
      </EmptyState>
    </div>
  );
}
