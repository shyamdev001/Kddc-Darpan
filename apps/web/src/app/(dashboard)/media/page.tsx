import { Images } from "lucide-react";
import { EmptyState } from "../empty-state";
import { PageHeader } from "../page-header";

export default function MediaPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Media" description="Posters and videos that can be added to playlists." />
      <EmptyState icon={Images} title="No media yet" note="Uploading is the next feature being built.">
        Upload JPG or PNG posters and MP4 videos. Images are resized to fit 1920 × 1080, videos are
        converted for the TVs, and Gujarati file names are kept exactly as you named them.
      </EmptyState>
    </div>
  );
}
