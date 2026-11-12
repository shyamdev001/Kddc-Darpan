"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, Building2, CalendarClock, Images, LayoutGrid, ListVideo, MonitorPlay } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/screens", label: "Screens", icon: MonitorPlay },
  { href: "/media", label: "Media", icon: Images },
  { href: "/playlists", label: "Playlists", icon: ListVideo },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/branches", label: "Branches", icon: Building2 },
  { href: "/alerts", label: "Alerts", icon: BellRing },
] as const;

export function SidebarNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Same links with nothing highlighted, shown until the URL is known. */
export function SidebarNavFallback() {
  return <NavLinks pathname={null} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] lg:flex-col lg:px-3 lg:pt-2">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-md px-3 py-2 text-[15px] whitespace-nowrap transition-colors",
              active
                ? "bg-neel-soft font-medium text-neel"
                : "text-muted-foreground hover:bg-mist hover:text-foreground",
            )}
          >
            {active && (
              <span aria-hidden className="absolute top-2 bottom-2 left-0 hidden w-[3px] rounded-r bg-neel lg:block" />
            )}
            <Icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
