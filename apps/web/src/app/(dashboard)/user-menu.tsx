import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  HO_ADMIN: "Head office admin",
  REGION_MANAGER: "Region manager",
  BRANCH_VIEWER: "Branch viewer",
};

export async function UserMenu() {
  const user = await getSessionUser();
  // Cookie present but session invalid (expired, account disabled): back to login.
  if (!user) redirect("/login?expired=1");

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role] ?? user.role}</p>
      </div>
      <LogoutButton />
    </div>
  );
}
