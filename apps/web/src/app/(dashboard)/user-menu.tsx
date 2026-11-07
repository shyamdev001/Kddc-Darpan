import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  HO_ADMIN: "Head office admin",
  REGION_MANAGER: "Region manager",
  BRANCH_VIEWER: "Branch viewer",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export async function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = await getSessionUser();
  // Cookie present but session invalid (expired, account disabled): back to sign-in.
  if (!user) redirect("/login?expired=1");

  if (compact) return <LogoutButton iconOnly />;

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white"
      >
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-[13px] text-muted-foreground" title={user.email}>
          {ROLE_LABEL[user.role] ?? user.role}
        </p>
      </div>
      <LogoutButton iconOnly />
    </div>
  );
}
