import type { Metadata } from "next";
import { PageHeader } from "../page-header";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users | KDCC Darpan" };

export default function UsersPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Users" description="Who can sign in to the dashboard, and what each person can see and change." />
      <UsersView />
    </div>
  );
}
