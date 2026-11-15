import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { LiveWall } from "./live-wall";

export const metadata: Metadata = { title: "Live wall | KDCC Darpan" };

export default function LivePage() {
  return (
    <div className="mx-auto max-w-[96rem]">
      <PageHeader
        title="Live wall"
        description="What every screen is showing right now. Each TV reports the moment its picture changes, so this is a few seconds behind at most."
      />
      <LiveWall />
    </div>
  );
}
