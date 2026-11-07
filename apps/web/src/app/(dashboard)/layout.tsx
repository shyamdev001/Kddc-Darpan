import { Suspense } from "react";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-sidebar md:w-60 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            દ
          </div>
          <span className="font-semibold tracking-tight">KDCC Darpan</span>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-4 md:px-6">
          <Suspense fallback={<div className="h-8 w-40 animate-pulse rounded-md bg-muted" />}>
            <UserMenu />
          </Suspense>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
