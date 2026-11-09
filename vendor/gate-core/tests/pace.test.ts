import { describe, expect, it } from 'vitest';
import { addDays, dayDiff } from '../src/dates.js';
import { hoursByDay, neededPerDay, projectFinish, recentPace, shouldNudge, status, workDays } from '../src/pace.js';

const S = (day: string, hours: number) => ({ day, seconds: Math.round(hours * 3600) });

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayDiff('2026-10-21', '2027-02-06')).toBe(108);
  });
});

describe('hoursByDay', () => {
  it('adds sessions of one day and ignores bad rows', () => {
    const m = hoursByDay([S('2026-10-20', 1), S('2026-10-20', 0.5), { day: '2026-10-19', seconds: 0 }, null, { seconds: 60 }, S('2026-10-18', 2)]);
    expect(m['2026-10-20']).toBeCloseTo(1.5);
    expect(m['2026-10-18']).toBeCloseTo(2);
    expect(m['2026-10-19']).toBeUndefined();
  });
});

describe('recentPace', () => {
  it('gives no pace without finished days; today alone is not a finished day', () => {
    expect(recentPace([], '2026-10-21').avg).toBeNull();
    const r = recentPace([S('2026-10-21', 3)], '2026-10-21');
    expect(r.avg).toBeNull();
    expect(r.today).toBeCloseTo(3);
  });
  it('counts only days since tracking began; empty days inside count as zero', () => {
    const r = recentPace([S('2026-10-19', 4), S('2026-10-20', 2)], '2026-10-21');
    expect(r.days).toBe(2);
    expect(r.avg).toBeCloseTo(3);
    expect(r.yesterday).toBeCloseTo(2);
    const g = recentPace([S('2026-10-17', 6)], '2026-10-21');
    expect(g.days).toBe(4);
    expect(g.avg).toBeCloseTo(1.5);
  });
  it('uses a 7-day window and ignores older days', () => {
    const sess = [S('2026-10-01', 10)];
    for (let i = 1; i <= 7; i++) sess.push(S(addDays('2026-10-21', -i), 2));
    const r = recentPace(sess, '2026-10-21');
    expect(r.days).toBe(7);
    expect(r.avg).toBeCloseTo(2);
  });
});

describe('workDays / neededPerDay / projectFinish', () => {
  it('counts both ends and can skip Sundays', () => {
    expect(workDays('2026-10-21', '2026-10-21', false)).toBe(1);
    expect(workDays('2026-10-21', '2026-10-20', false)).toBe(0);
    expect(workDays('2026-10-19', '2026-10-25', false)).toBe(7);
    expect(workDays('2026-10-19', '2026-10-25', true)).toBe(6);
  });
  it('neededPerDay handles zero, passed deadlines and normal cases', () => {
    expect(neededPerDay(710, '2026-10-21', '2026-12-31', false)).toBeCloseTo(710 / 72);
    expect(neededPerDay(0, '2026-10-21', '2026-12-31', false)).toBe(0);
    expect(neededPerDay(10, '2026-10-21', '2026-10-20', false)).toBeNull();
  });
  it('projectFinish follows hours, Sundays and the cap', () => {
    expect(projectFinish(0, 0, '2026-10-21', false)).toBe('2026-10-21');
    expect(projectFinish(10, 0, '2026-10-21', false)).toBeNull();
    expect(projectFinish(10, 0.01, '2026-10-21', false)).toBeNull();
    expect(projectFinish(10, 5, '2026-10-21', false)).toBe('2026-10-22');
    expect(projectFinish(10.1, 5, '2026-10-21', false)).toBe('2026-10-23');
    expect(projectFinish(10, 5, '2026-10-24', true)).toBe('2026-10-26');
    expect(projectFinish(1e6, 1, '2026-10-21', false)).toBeNull();
  });
});

describe('status', () => {
  it('maps pace to none / ok / close / behind', () => {
    expect(status(null, 8)).toBe('none');
    expect(status(8, 8)).toBe('ok');
    expect(status(6.5, 8)).toBe('close');
    expect(status(3, 8)).toBe('behind');
    expect(status(0, 8)).toBe('behind');
    expect(status(1, null)).toBe('behind');
    expect(status(0, 0)).toBe('ok');
  });
});

describe('shouldNudge', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 21, h, m, 0);
  const base = { at: '05:00', until: '21:00', every: 60, max: 4, count: 0, last: 0, secs: 0, minSecs: 900, running: false };
  it('fires only inside the window', () => {
    expect(shouldNudge({ ...base, now: at(4, 59) })).toBe(false);
    expect(shouldNudge({ ...base, now: at(5, 0) })).toBe(true);
    expect(shouldNudge({ ...base, now: at(20, 59) })).toBe(true);
    expect(shouldNudge({ ...base, now: at(21, 0) })).toBe(false);
  });
  it('stays quiet once study started, while running, or after the daily maximum', () => {
    expect(shouldNudge({ ...base, now: at(9, 0), secs: 899 })).toBe(true);
    expect(shouldNudge({ ...base, now: at(9, 0), secs: 900 })).toBe(false);
    expect(shouldNudge({ ...base, now: at(9, 0), running: true })).toBe(false);
    expect(shouldNudge({ ...base, now: at(9, 0), count: 4 })).toBe(false);
    expect(shouldNudge({ ...base, now: at(9, 0), count: 3 })).toBe(true);
  });
  it('waits the repeat gap', () => {
    const now = at(9, 0);
    const t = now.getTime();
    expect(shouldNudge({ ...base, now, count: 1, last: t - 59 * 60000 })).toBe(false);
    expect(shouldNudge({ ...base, now, count: 1, last: t - 60 * 60000 })).toBe(true);
  });
  it('bad settings never fire', () => {
    expect(shouldNudge({ ...base, now: at(9, 0), at: 'soon' })).toBe(false);
    expect(shouldNudge({ ...base, now: at(9, 0), at: '25:00' })).toBe(false);
    expect(shouldNudge({ ...base, now: at(9, 0), minSecs: 0, secs: 0 })).toBe(true);
    expect(shouldNudge({ ...base, now: at(9, 0), max: 0 })).toBe(false);
  });
});
