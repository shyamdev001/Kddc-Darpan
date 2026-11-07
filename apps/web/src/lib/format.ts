// Display helpers. All dates show in India time, whatever the viewer's computer is set to.
const IST = "Asia/Kolkata";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "4 min 30 s", "1 h 5 min", "45 s": for sentences, where 4:30 would be ambiguous. */
export function formatLoop(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const relFmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatAgo(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return relFmt.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return relFmt.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86_400) return relFmt.format(Math.round(diff / 86_400), "day");
  return formatDay(iso);
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
const dayShortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST });
const ymdFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST });

export function formatDay(iso: string, short = false): string {
  return (short ? dayShortFmt : dayFmt).format(new Date(iso));
}

/** ISO instant -> "YYYY-MM-DD" in India time, for <input type="date">. */
export function toDateInput(iso: string | null): string {
  return iso ? ymdFmt.format(new Date(iso)) : "";
}

/** "YYYY-MM-DD" from a date input -> ISO instant at the start or end of that day in India time. */
export function fromDateInput(value: string, edge: "start" | "end"): string | null {
  if (!value) return null;
  return `${value}T${edge === "start" ? "00:00:00" : "23:59:59"}+05:30`;
}

export type Schedule = { kind: "none" } | { kind: "upcoming"; label: string } | { kind: "live"; label: string } | { kind: "ending"; label: string } | { kind: "expired"; label: string };

/** Where an ad is in its run, for the badge on each tile. */
export function scheduleOf(startDate: string | null, endDate: string | null, now = Date.now()): Schedule {
  const start = startDate ? Date.parse(startDate) : null;
  const end = endDate ? Date.parse(endDate) : null;
  if (end !== null && end < now) return { kind: "expired", label: `Ended ${formatDay(endDate!, true)}` };
  if (start !== null && start > now) return { kind: "upcoming", label: `Starts ${formatDay(startDate!, true)}` };
  if (end !== null) {
    // Whole calendar days in India time: last day 10 Nov, today 7 Nov -> 3.
    const days = Math.round((Date.parse(ymdFmt.format(end)) - Date.parse(ymdFmt.format(now))) / 86_400_000);
    if (days <= 7) {
      const label = days <= 0 ? "Ends today" : days === 1 ? "Ends tomorrow" : `Ends in ${days} days`;
      return { kind: "ending", label };
    }
    return { kind: "live", label: `Until ${formatDay(endDate!, true)}` };
  }
  return { kind: "none" };
}
