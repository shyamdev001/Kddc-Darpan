import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { MediaLibrary } from "./media-library";

export const metadata: Metadata = { title: "Media | KDCC Darpan" };

export default function MediaPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Media"
        description="Posters and videos for the branch screens. Images are fitted to 1920×1080 and videos converted so every TV can play them."
      />
      <MediaLibrary />
    </div>
  );
}
