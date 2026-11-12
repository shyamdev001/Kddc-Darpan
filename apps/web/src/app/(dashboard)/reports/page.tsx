import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Proof of play | KDCC Darpan" };

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Proof of play" description="What each screen actually showed, from the TVs' own records." />
      <ReportsView />
    </div>
  );
}
