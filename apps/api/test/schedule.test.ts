// Time slots and display hours (packages/shared/src/schedule.ts). Everything is judged in IST, and
// the TV has the same rules in Kotlin, so a change here must be made there too.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDays, hoursOn, slotActive, slotsActive, slotsExpired, type TimeSlot } from '@darpan/shared';

/** A moment written as Indian clock time. 12 Nov 2026 is a Thursday. */
const ist = (local: string) => new Date(`${local}:00+05:30`);
const slot = (s: Partial<TimeSlot>): TimeSlot => ({ days: [], start: null, end: null, fromDate: null, toDate: null, ...s });
const WEEKDAYS = [1, 2, 3, 4, 5];

describe('time slots', () => {
  const office = slot({ days: WEEKDAYS, start: '09:00', end: '18:00' });

  it('plays inside the window on a listed day', () => {
    assert.equal(slotActive(office, ist('2026-11-12T10:00')), true);
    assert.equal(slotActive(office, ist('2026-11-12T09:00')), true);
  });

  it('stops at the end time and does not start early', () => {
    assert.equal(slotActive(office, ist('2026-11-12T18:00')), false);
    assert.equal(slotActive(office, ist('2026-11-12T08:59')), false);
  });

  it('skips days that are not listed', () => {
    assert.equal(slotActive(office, ist('2026-11-14T10:00')), false); // Saturday
    assert.equal(slotActive(office, ist('2026-11-15T10:00')), false); // Sunday
  });

  it('uses Indian time, not UTC', () => {
    // 03:45 UTC is 09:15 in India
    assert.equal(slotActive(office, new Date('2026-11-12T03:45:00Z')), true);
    // 20:00 UTC on Thursday is already 01:30 on Friday in India
    const thursdayOnly = slot({ days: [4] });
    assert.equal(slotActive(thursdayOnly, new Date('2026-11-12T20:00:00Z')), false);
    assert.equal(slotActive(slot({ days: [5] }), new Date('2026-11-12T20:00:00Z')), true);
  });

  it('runs past midnight and counts the early hours as the day it started', () => {
    const lateThursday = slot({ days: [4], start: '22:00', end: '02:00' });
    assert.equal(slotActive(lateThursday, ist('2026-11-12T23:00')), true);
    assert.equal(slotActive(lateThursday, ist('2026-11-13T01:00')), true); // Friday 1 am, Thursday's slot
    assert.equal(slotActive(lateThursday, ist('2026-11-13T02:00')), false);
    assert.equal(slotActive(lateThursday, ist('2026-11-12T01:00')), false); // belongs to Wednesday
    assert.equal(slotActive(lateThursday, ist('2026-11-13T23:00')), false); // Friday evening
  });

  it('treats missing times as the whole day', () => {
    const allThursday = slot({ days: [4] });
    assert.equal(slotActive(allThursday, ist('2026-11-12T00:00')), true);
    assert.equal(slotActive(allThursday, ist('2026-11-12T23:59')), true);
    assert.equal(slotActive(allThursday, ist('2026-11-13T00:00')), false);
  });

  it('keeps to the date range, both ends included', () => {
    const diwali = slot({ fromDate: '2026-11-10', toDate: '2026-11-12' });
    assert.equal(slotActive(diwali, ist('2026-11-09T23:59')), false);
    assert.equal(slotActive(diwali, ist('2026-11-10T00:00')), true);
    assert.equal(slotActive(diwali, ist('2026-11-12T23:59')), true);
    assert.equal(slotActive(diwali, ist('2026-11-13T00:00')), false);
  });

  it('plays always when there are no slots, and when any slot matches', () => {
    assert.equal(slotsActive([], ist('2026-11-12T03:00')), true);
    const morning = slot({ start: '06:00', end: '09:00' });
    const evening = slot({ start: '17:00', end: '20:00' });
    assert.equal(slotsActive([morning, evening], ist('2026-11-12T18:00')), true);
    assert.equal(slotsActive([morning, evening], ist('2026-11-12T12:00')), false);
  });

  it('expires only when every slot has a last day in the past', () => {
    const now = ist('2026-11-12T12:00');
    assert.equal(slotsExpired([], now), false);
    assert.equal(slotsExpired([slot({ toDate: '2026-11-11' })], now), true);
    assert.equal(slotsExpired([slot({ toDate: '2026-11-12' })], now), false); // last day is today
    assert.equal(slotsExpired([slot({ toDate: '2026-11-11' }), slot({})], now), false);
  });
});

describe('display hours', () => {
  // Bank hours: Mon–Sat 09:00–18:00, closed on the 2nd and 4th Saturday.
  const bank = { days: [1, 2, 3, 4, 5, 6], on: '09:00', off: '18:00', closedSaturdays: [2, 4] };

  it('is on during opening hours and off outside them', () => {
    assert.equal(hoursOn(bank, ist('2026-11-12T10:00')), true);
    assert.equal(hoursOn(bank, ist('2026-11-12T18:30')), false);
    assert.equal(hoursOn(bank, ist('2026-11-15T10:00')), false); // Sunday
  });

  it('is off on the 2nd and 4th Saturday only', () => {
    assert.equal(hoursOn(bank, ist('2026-11-07T10:00')), true); // 1st Saturday
    assert.equal(hoursOn(bank, ist('2026-11-14T10:00')), false); // 2nd
    assert.equal(hoursOn(bank, ist('2026-11-21T10:00')), true); // 3rd
    assert.equal(hoursOn(bank, ist('2026-11-28T10:00')), false); // 4th
  });

  it('is on all day when on and off times are the same', () => {
    const always = { days: [], on: '00:00', off: '00:00', closedSaturdays: [] };
    assert.equal(hoursOn(always, ist('2026-11-12T03:00')), true);
  });
});

describe('day names', () => {
  it('describes the days the way the dashboard shows them', () => {
    assert.equal(describeDays([]), 'Every day');
    assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    assert.equal(describeDays(WEEKDAYS), 'Mon–Fri');
    assert.equal(describeDays([6, 1, 3]), 'Mon, Wed, Sat');
    assert.equal(describeDays([0, 1]), 'Sun, Mon');
  });
});
