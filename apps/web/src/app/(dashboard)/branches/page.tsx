import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { PlaceTreeView } from "./place-tree";

export const metadata: Metadata = { title: "Branches | KDCC Darpan" };

export default function BranchesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Branches"
        description="Regions, talukas and branches. A playlist set here plays on every screen below it, unless something closer is set."
      />
      <PlaceTreeView />
    </div>
  );
}
