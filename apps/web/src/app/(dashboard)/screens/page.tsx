import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { PairScreenButton } from "./pair-screen-dialog";
import { ScreenList } from "./screen-list";

export const metadata: Metadata = { title: "Screens | KDCC Darpan" };

export default function ScreensPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Screens"
        description="Every branch TV, whether it is online, and what it is playing."
        actions={<PairScreenButton />}
      />
      <ScreenList />
    </div>
  );
}
