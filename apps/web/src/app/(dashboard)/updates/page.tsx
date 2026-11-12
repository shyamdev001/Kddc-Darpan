import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { UpdatesView } from "./updates-view";

export const metadata: Metadata = { title: "App updates | KDCC Darpan" };

export default function UpdatesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="App updates" description="Send a new version of the TV app to the screens, test screens first." />
      <UpdatesView />
    </div>
  );
}
