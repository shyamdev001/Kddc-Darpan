// Time slots (dayparting) and display hours. All times are Asia/Kolkata (IST, UTC+5:30, no daylight saving).
// The TV app has the same rules in Kotlin (Schedule.kt): keep the two in step.

import type { PlaylistSource } from './screen';

/** When a scheduled playlist plays. Empty days = every day; null times = whole day; null dates = no limit. */
export interface TimeSlot {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** "HH:mm". An end earlier than the start runs past midnight. */
  start: string | null;
  end: string | null;
  /** "YYYY-MM-DD", inclusive */
  fromDate: string | null;
  toDate: string | null;
}

/** When screens are switched on. Outside these hours the TV shows black. */
export interface DisplayHoursValue {
  days: number[];
  on: string; // "HH:mm"
  off: string; // "HH:mm"
  /** Saturdays of the month that are off, e.g. [2, 4] for bank holidays. */
  closedSaturdays: number[];
  /**
   * Screen brightness while on, in percent (BRIGHTNESS_MIN to 100). Unset or null leaves the TV's
   * own setting alone. Only for screen hours; the alert window ignores it.
   */
  brightness?: number | null;
}

export const BRIGHTNESS_MIN = 10;

export const IST_OFFSET_MIN = 330;
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface LocalDay {
  date: string; // YYYY-MM-DD
  dow: number;
  dayOfMonth: number;
}

function localDay(at: Date, shiftDays = 0): LocalDay {
  const d = new Date(at.getTime() + IST_OFFSET_MIN * 60_000 + shiftDays * 86_400_000);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), dayOfMonth: d.getUTCDate() };
}

function localMinutes(at: Date): number {
  const d = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Shared shape of slots and hours: a daily window [start, end) that belongs to the day it starts on.
 * start === end means the whole day.
 */
function windowActive(at: Date, start: number, end: number, dayOk: (d: LocalDay) => boolean): boolean {
  const now = localMinutes(at);
  if (start === end) return dayOk(localDay(at));
  if (start < end) return now >= start && now < end && dayOk(localDay(at));
  // runs past midnight: the evening part belongs to today, the early-morning part to yesterday
  if (now >= start) return dayOk(localDay(at));
  if (now < end) return dayOk(localDay(at, -1));
  return false;
}

export function slotActive(slot: TimeSlot, at: Date): boolean {
  const start = slot.start ? toMinutes(slot.start) : 0;
  const end = slot.end ? toMinutes(slot.end) : 24 * 60; // open end = until midnight
  return windowActive(at, start, end, (d) => {
    if (slot.days.length && !slot.days.includes(d.dow)) return false;
    if (slot.fromDate && d.date < slot.fromDate) return false;
    if (slot.toDate && d.date > slot.toDate) return false;
    return true;
  });
}

/** No slots means "always". */
export function slotsActive(slots: TimeSlot[], at: Date): boolean {
  return slots.length === 0 || slots.some((s) => slotActive(s, at));
}

/** Has every slot ended for good? (A schedule that can never play again.) */
export function slotsExpired(slots: TimeSlot[], at: Date): boolean {
  if (!slots.length) return false;
  const today = localDay(at).date;
  return slots.every((s) => s.toDate !== null && s.toDate < today);
}

export function hoursOn(h: DisplayHoursValue, at: Date): boolean {
  return windowActive(at, toMinutes(h.on), toMinutes(h.off), (d) => {
    if (h.days.length && !h.days.includes(d.dow)) return false;
    if (d.dow === 6 && h.closedSaturdays.includes(Math.ceil(d.dayOfMonth / 7))) return false;
    return true;
  });
}

/** "Mon–Fri", "Every day", "Mon, Wed, Sat" */
export function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === 7) return 'Every day';
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j - i >= 2 ? `${DAY_NAMES[sorted[i]]}–${DAY_NAMES[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => DAY_NAMES[d]).join(', '));
    i = j + 1;
  }
  return runs.join(', ');
}

// ---- Dashboard API ----

/** A playlist that plays only at certain times, set at some level. */
export interface ScheduleEntry {
  id: string;
  level: PlaylistSource;
  /** The region, taluka, branch or screen; null for every screen. */
  target: { id: string; name: string } | null;
  playlist: { id: string; name: string };
  slots: TimeSlot[];
  /** Playing somewhere right now (its slot is active). */
  activeNow: boolean;
  expired: boolean;
  createdAt: string;
}

export interface CreateScheduleRequest {
  level: PlaylistSource;
  targetId?: string;
  playlistId: string;
  slots: TimeSlot[];
}
export type UpdateScheduleRequest = Omit<CreateScheduleRequest, 'level' | 'targetId'>;

export interface DisplayHoursEntry {
  id: string;
  level: PlaylistSource;
  target: { id: string; name: string } | null;
  hours: DisplayHoursValue;
}

export interface SetDisplayHoursRequest {
  level: PlaylistSource;
  targetId?: string;
  /** null removes the hours set at this level (it then follows the level above). */
  hours: DisplayHoursValue | null;
}
