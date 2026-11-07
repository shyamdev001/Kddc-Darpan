import { DAY_NAMES, toMinutes, type DisplayHoursValue, type TimeSlot } from "@darpan/shared";
import { cn } from "@/lib/utils";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY = 24 * 60;

type Span = [number, number]; // minutes from midnight

function spansFor(dow: number, days: number[], start: number, end: number): Span[] {
  const has = (d: number) => days.length === 0 || days.includes(d);
  const prev = (dow + 6) % 7;
  if (start === end) return has(dow) ? [[0, DAY]] : [];
  if (start < end) return has(dow) ? [[start, end]] : [];
  // past midnight: evening of today, early morning that belongs to yesterday
  const out: Span[] = [];
  if (has(dow)) out.push([start, DAY]);
  if (has(prev)) out.push([0, end]);
  return out;
}

export function slotSpans(slot: TimeSlot, dow: number): Span[] {
  return spansFor(dow, slot.days, slot.start ? toMinutes(slot.start) : 0, slot.end ? toMinutes(slot.end) : DAY);
}

export function hoursSpans(h: DisplayHoursValue, dow: number): Span[] {
  return spansFor(dow, h.days, toMinutes(h.on), toMinutes(h.off));
}

/**
 * A week at a glance: one thin row per day, filled where the slots play. Date limits are not drawn
 * (they are written next to it). Display hours, when given, show as a pale band behind.
 */
export function WeekBar({ slots, hours, className }: { slots?: TimeSlot[]; hours?: DisplayHoursValue | null; className?: string }) {
  return (
    <div className={cn("grid gap-[3px]", className)} aria-hidden>
      {WEEK.map((dow) => (
        <div key={dow} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[11px] leading-none text-muted-foreground">{DAY_NAMES[dow]}</span>
          <div className="relative h-[7px] overflow-hidden rounded-full bg-mist">
            {hours &&
              hoursSpans(hours, dow).map(([a, b], i) => (
                <span
                  key={`h${i}`}
                  className="absolute inset-y-0 rounded-full bg-neel/45"
                  style={{ left: `${(a / DAY) * 100}%`, width: `${((b - a) / DAY) * 100}%` }}
                />
              ))}
            {slots?.flatMap((s, si) =>
              slotSpans(s, dow).map(([a, b], i) => (
                <span
                  key={`${si}-${i}`}
                  className="absolute inset-y-0 rounded-full bg-neel"
                  style={{ left: `${(a / DAY) * 100}%`, width: `${((b - a) / DAY) * 100}%` }}
                />
              )),
            )}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
        <span />
        <div className="flex justify-between text-[10px] leading-none text-muted-foreground tabular-nums">
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>12 am</span>
        </div>
      </div>
    </div>
  );
}
