import { redirect } from "next/navigation";
import { AccessCheck, SessionProvider } from "@/components/session-context";
import { getSessionUser } from "@/lib/session";
import { SidebarNav } from "./sidebar-nav";

/**
 * Reads the signed-in user once per request (getSessionUser is cached) and hands the role to
 * client components: the sidebar (`nav`) or the page, which is wrapped in an access check.
 */
export async function SessionGate({ nav = false, children }: { nav?: boolean; children?: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  if (nav) return <SidebarNav role={user.role} />;
  return (
    <SessionProvider user={{ id: user.id, name: user.name, role: user.role }}>
      <AccessCheck>{children}</AccessCheck>
    </SessionProvider>
  );
}
