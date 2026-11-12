"use client";

import { BRIGHTNESS_MIN, type DisplayHoursValue } from "@darpan/shared";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DayPicker, TimeInput } from "./controls";
import { WeekBar } from "./week-bar";

export const DEFAULT_HOURS: DisplayHoursValue = { days: [1, 2, 3, 4, 5, 6], on: "09:30", off: "18:30", closedSaturdays: [2, 4], brightness: null };

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
  withBrightness = false,
}: {
  value: DisplayHoursValue;
  onChange: (h: DisplayHoursValue) => void;
  idPrefix: string;
  labels?: HoursLabels;
  /** Screen hours only: how bright the screens are while on. */
  withBrightness?: boolean;
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
      {withBrightness && <BrightnessField value={value.brightness ?? null} onChange={(brightness) => set({ brightness })} idPrefix={idPrefix} />}
    </div>
  );
}

const DEFAULT_BRIGHTNESS = 80;

/** Off = the TV keeps its own brightness. On = a percentage the TV applies while it is on. */
function BrightnessField({ value, onChange, idPrefix }: { value: number | null; onChange: (v: number | null) => void; idPrefix: string }) {
  const on = value !== null;
  return (
    <div className="grid gap-2 border-t pt-4">
      <label className="flex items-start gap-2.5 text-[15px]">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? DEFAULT_BRIGHTNESS : null)}
          className="mt-1 size-4 accent-neel"
        />
        <span>
          Set screen brightness
          <span className="block text-sm text-muted-foreground">
            {on ? "The screens use this brightness while they are on." : "Off: each TV keeps the brightness set on the TV itself."}
          </span>
        </span>
      </label>
      {on && (
        <div className="flex items-center gap-3 pl-6.5">
          <input
            id={`${idPrefix}-brightness`}
            type="range"
            min={BRIGHTNESS_MIN}
            max={100}
            step={5}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Screen brightness"
            aria-valuetext={`${value}%`}
            className="h-2 w-full max-w-72 accent-neel"
          />
          <output htmlFor={`${idPrefix}-brightness`} className="w-12 text-right text-[15px] font-medium tabular-nums">
            {value}%
          </output>
        </div>
      )}
    </div>
  );
}
