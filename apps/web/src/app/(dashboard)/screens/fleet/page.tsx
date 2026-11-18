import type { Metadata } from "next";
import { PageHeader } from "../../page-header";
import { FleetView } from "./fleet-view";

export const metadata: Metadata = { title: "TV models | KDCC Darpan" };

export default function FleetPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="TV models"
        description="What the screens in your area are, and what each can do, as the TVs reported it."
      />
      <FleetView />
    </div>
  );
}
