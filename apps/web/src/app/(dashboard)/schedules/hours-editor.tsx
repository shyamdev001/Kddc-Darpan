"use client";

import type { DisplayHoursValue } from "@darpan/shared";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DayPicker, TimeInput } from "./controls";
import { WeekBar } from "./week-bar";

export const DEFAULT_HOURS: DisplayHoursValue = { days: [1, 2, 3, 4, 5, 6], on: "09:30", off: "18:30", closedSaturdays: [2, 4] };

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

export interface HoursLabels {
  days: string;
  on: string;
  off: string;
  saturdays: string;
  saturdayHint: string;
}

const SCREEN_LABELS: HoursLabels = {
  days: "Days the screens are on",
  on: "Turn on",
  off: "Turn off",
  saturdays: "Saturdays that are off",
  saturdayHint: "Banks close on the 2nd and 4th Saturday. Screens stay dark on the ones picked here.",
};

/** Days, on/off times and which Saturdays are bank holidays. Controlled. */
export function HoursEditor({
  value,
  onChange,
  idPrefix,
  labels = SCREEN_LABELS,
}: {
  value: DisplayHoursValue;
  onChange: (h: DisplayHoursValue) => void;
  idPrefix: string;
  labels?: HoursLabels;
}) {
  const set = (patch: Partial<DisplayHoursValue>) => onChange({ ...value, ...patch });
  const saturdays = value.days.includes(6);

  return (
    <div className="grid gap-4">
      <DayPicker label={labels.days} value={value.days} onChange={(days) => set({ days })} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-on`}>{labels.on}</Label>
          <TimeInput id={`${idPrefix}-on`} value={value.on} onChange={(on) => set({ on })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-off`}>{labels.off}</Label>
          <TimeInput id={`${idPrefix}-off`} value={value.off} onChange={(off) => set({ off })} />
        </div>
      </div>
      {saturdays && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">{labels.saturdays}</span>
          <div role="group" aria-label={labels.saturdays} className="flex flex-wrap gap-1.5">
            {ORDINAL.map((label, i) => {
              const n = i + 1;
              const on = value.closedSaturdays.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({ closedSaturdays: on ? value.closedSaturdays.filter((x) => x !== n) : [...value.closedSaturdays, n].sort() })
                  }
                  className={cn(
                    "h-9 min-w-12 rounded-md border px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    on ? "border-ink bg-ink text-white" : "border-input bg-card text-muted-foreground hover:bg-mist hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">{labels.saturdayHint}</p>
        </div>
      )}
      {value.days.length > 0 && <WeekBar hours={value} />}
    </div>
  );
}
