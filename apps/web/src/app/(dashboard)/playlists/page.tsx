import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { NewPlaylistButton } from "./new-playlist-dialog";
import { PlaylistList } from "./playlist-list";

export const metadata: Metadata = { title: "Playlists | KDCC Darpan" };

export default function PlaylistsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Playlists"
        description="A playlist is the loop a screen plays: posters and videos in order, each for a set time."
        actions={<NewPlaylistButton />}
      />
      <PlaylistList />
    </div>
  );
}
