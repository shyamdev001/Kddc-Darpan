import { describeDays, type DisplayHoursValue, type PlaylistSource, type TimeSlot } from "@darpan/shared";

/** "09:30" -> "9:30 am" */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-11-08" -> "8 Nov 2026" */
export function day(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function slotTimes(slot: TimeSlot): string {
  if ((!slot.start || slot.start === "00:00") && !slot.end) return "all day";
  return `${time12(slot.start ?? "00:00")} to ${slot.end ? time12(slot.end) : "midnight"}`;
}

export function slotDates(slot: TimeSlot): string | null {
  if (slot.fromDate && slot.toDate) return slot.fromDate === slot.toDate ? `on ${day(slot.fromDate)}` : `${day(slot.fromDate)} to ${day(slot.toDate)}`;
  if (slot.fromDate) return `from ${day(slot.fromDate)}`;
  if (slot.toDate) return `until ${day(slot.toDate)}`;
  return null;
}

/** "Mon–Fri, 9:00 am to 12:00 pm, 8 Nov 2026 to 10 Nov 2026" */
export function describeSlot(slot: TimeSlot): string {
  return [describeDays(slot.days), slotTimes(slot), slotDates(slot)].filter(Boolean).join(", ");
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

export function describeHours(h: DisplayHoursValue): string {
  const times = `${describeDays(h.days)}, ${time12(h.on)} to ${time12(h.off)}`;
  const base = h.brightness != null ? `${times} at ${h.brightness}% brightness` : times;
  if (!h.closedSaturdays.length || (h.days.length && !h.days.includes(6))) return base;
  const which = h.closedSaturdays.map((n) => ORDINAL[n]);
  const list = which.length > 1 ? `${which.slice(0, -1).join(", ")} and ${which.at(-1)}` : which[0];
  return `${base}; off on the ${list} Saturday`;
}

export const LEVEL_TEXT: Record<PlaylistSource, string> = {
  ALL: "Every screen",
  REGION: "Region",
  TALUKA: "Taluka",
  BRANCH: "Branch",
  SCREEN: "Screen",
};

export function whereText(level: PlaylistSource, target: { name: string } | null): string {
  return level === "ALL" ? "Every screen" : `${LEVEL_TEXT[level]} ${target?.name ?? ""}`.trim();
}
