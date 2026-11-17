// The schedule edge cases in packages/shared/test-vectors/schedule.json. The TV runs the same file
// against its Kotlin copy of the rules (ScheduleVectorsTest.kt), so the two cannot drift apart.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hoursOn, slotActive, type DisplayHoursValue, type TimeSlot } from '@darpan/shared';

interface Case {
  name: string;
  slot?: Partial<TimeSlot>;
  hours?: DisplayHoursValue;
  at: string;
  expect: boolean;
}

// Compiled to apps/api/dist-test/test, or run from apps/api/test: find the repo root either way.
const root = [resolve(__dirname, '../../../..'), resolve(__dirname, '../../..')].find((d) => {
  try {
    readFileSync(resolve(d, 'packages/shared/test-vectors/schedule.json'));
    return true;
  } catch {
    return false;
  }
})!;
const { cases } = JSON.parse(readFileSync(resolve(root, 'packages/shared/test-vectors/schedule.json'), 'utf8')) as { cases: Case[] };

describe('schedule edge cases (shared with the TV)', () => {
  it('has cases to run', () => assert.ok(cases.length >= 20));
  for (const c of cases) {
    it(c.name, () => {
      const at = new Date(c.at);
      const got = c.slot
        ? slotActive({ days: [], start: null, end: null, fromDate: null, toDate: null, ...c.slot }, at)
        : hoursOn(c.hours!, at);
      assert.equal(got, c.expect);
    });
  }
});
