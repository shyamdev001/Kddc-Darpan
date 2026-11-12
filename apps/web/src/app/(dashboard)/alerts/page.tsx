import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { AlertsView } from "./alerts-view";

export const metadata: Metadata = { title: "Alerts | KDCC Darpan" };

export default function AlertsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Alerts" description="Screens that stopped checking in, and who gets an email about it." />
      <AlertsView />
    </div>
  );
}
