import type { LucideIcon } from "lucide-react";

/** Shown on a page before its feature exists or before there is any data. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  note,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-input bg-card px-6 py-10 sm:px-10 sm:py-14">
      <span className="flex size-11 items-center justify-center rounded-lg bg-neel-soft text-neel">
        <Icon className="size-5" />
      </span>
      <div className="max-w-xl">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-muted-foreground">{children}</p>
      </div>
      {note && <p className="rounded-md bg-mist px-3 py-1.5 text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
