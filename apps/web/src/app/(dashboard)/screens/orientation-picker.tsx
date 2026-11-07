"use client";

import type { Orientation } from "@darpan/shared";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Orientation; label: string }[] = [
  { value: "LANDSCAPE", label: "Landscape" },
  { value: "PORTRAIT", label: "Portrait" },
];

/** Two choices drawn as the screen shape they describe. */
export function OrientationPicker({ value, onChange }: { value: Orientation; onChange: (o: Orientation) => void }) {
  return (
    <div role="radiogroup" aria-label="Orientation" className="flex gap-2">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[15px] transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active ? "border-neel bg-neel-soft font-medium text-neel" : "border-input bg-card hover:bg-mist",
            )}
          >
            <span
              aria-hidden
              className={cn("shrink-0 rounded-[3px] border-2", active ? "border-neel" : "border-muted-foreground/50", o.value === "LANDSCAPE" ? "h-4 w-7" : "h-7 w-4")}
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
