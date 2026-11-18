import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "../page-header";
import { PairScreenButton } from "./pair-screen-dialog";
import { ScreenList } from "./screen-list";

export const metadata: Metadata = { title: "Screens | KDCC Darpan" };

export default function ScreensPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Screens"
        description="Every branch TV, whether it is online, and what it is playing."
        actions={
          <div className="flex gap-2">
            <Link href="/screens/fleet" className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}>
              TV models
            </Link>
            <PairScreenButton />
          </div>
        }
      />
      <ScreenList />
    </div>
  );
}
