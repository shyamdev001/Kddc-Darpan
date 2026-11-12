import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "../page-header";
import { AccountView } from "./account-view";

export const metadata: Metadata = { title: "Account | KDCC Darpan" };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login?expired=1");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Account" description="Your sign-in details and two-step sign-in." />
      <AccountView user={session.user} initial={session.twoFactor} />
    </div>
  );
}
