import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import { SidebarNav, SidebarNavFallback } from "./sidebar-nav";
import { UserMenu } from "./user-menu";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <aside className="sticky top-0 z-20 flex shrink-0 flex-col border-b bg-sidebar lg:h-screen lg:w-64 lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-5">
          <Link href="/" className="flex items-center gap-3 rounded-md">
            <BrandMark />
            <span className="font-heading text-[17px] font-semibold tracking-tight">KDCC Darpan</span>
          </Link>
          <div className="lg:hidden">
            <Suspense fallback={null}>
              <UserMenu compact />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<SidebarNavFallback />}>
          <SidebarNav />
        </Suspense>

        <div className="mt-auto hidden border-t p-3 lg:block">
          <Suspense fallback={<div className="h-14 animate-pulse rounded-lg bg-muted" />}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
