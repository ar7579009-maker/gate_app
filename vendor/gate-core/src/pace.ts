// Pace maths for the Home screen and the study reminder. Pure functions, no I/O.
import { addDays, dayDiff, isSunday, minutesOf } from './dates.js';

export interface Session {
  day: string;
  seconds: number;
}

export type PaceStatus = 'none' | 'ok' | 'close' | 'behind';

export interface RecentPace {
  days: number;
  total: number;
  avg: number | null;
  today: number;
  yesterday: number;
}

/** Hours studied per day, from timer sessions. Bad rows are ignored. */
export function hoursByDay(sessions: ReadonlyArray<Partial<Session> | null | undefined>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const s of sessions) {
    if (!s || typeof s.day !== 'string') continue;
    const sec = Number(s.seconds);
    if (!(sec > 0)) continue;
    m[s.day] = (m[s.day] ?? 0) + sec / 3600;
  }
  return m;
}

/**
 * Average hours per day over the `windowDays` days before `today`. Today is not counted (not finished).
 * If tracking began less than a window ago, only the days since then count; empty days inside count as zero.
 */
export function recentPace(
  sessions: ReadonlyArray<Partial<Session> | null | undefined>,
  today: string,
  windowDays = 7,
): RecentPace {
  const byDay = hoursByDay(sessions);
  const before = Object.keys(byDay).filter((d) => d < today).sort();
  const base = {
    days: 0,
    total: 0,
    avg: null as number | null,
    today: byDay[today] ?? 0,
    yesterday: byDay[addDays(today, -1)] ?? 0,
  };
  const first = before[0];
  if (first === undefined) return base;
  const span = Math.min(windowDays, dayDiff(first, today));
  let total = 0;
  for (let i = 1; i <= span; i++) total += byDay[addDays(today, -i)] ?? 0;
  return { ...base, days: span, total, avg: total / span };
}

/** Calendar days from `from` to `to`, both included. Sundays are skipped when sunOff is set. */
export function workDays(from: string, to: string, sunOff: boolean): number {
  const n = dayDiff(from, to) + 1;
  if (n <= 0) return 0;
  if (!sunOff) return n;
  let c = 0;
  for (let i = 0; i < n; i++) if (!isSunday(addDays(from, i))) c++;
  return c;
}

/** Hours per day needed to use up `hoursLeft` by the deadline. null when the deadline has passed. */
export function neededPerDay(hoursLeft: number, today: string, deadline: string, sunOff: boolean): number | null {
  if (!(hoursLeft > 0)) return 0;
  const n = workDays(today, deadline, sunOff);
  return n > 0 ? hoursLeft / n : null;
}

/**
 * The day the hours run out at `perDay` hours a day (today counts as a full day).
 * Returns null if it never does, or if it is beyond `cap` days.
 */
export function projectFinish(
  hoursLeft: number,
  perDay: number,
  today: string,
  sunOff: boolean,
  cap = 900,
): string | null {
  if (!(hoursLeft > 0)) return today;
  if (!(perDay >= 0.05)) return null;
  let left = hoursLeft;
  for (let d = 0; d < cap; d++) {
    const date = addDays(today, d);
    if (sunOff && isSunday(date)) continue;
    left -= perDay;
    if (left <= 1e-9) return date;
  }
  return null;
}

/** 'ok' at or above the needed pace, 'close' within a quarter of it, otherwise 'behind'. */
export function status(avg: number | null, need: number | null): PaceStatus {
  if (avg === null) return 'none';
  if (need === null) return 'behind';
  if (need <= 0) return 'ok';
  const r = avg / need;
  if (r >= 1) return 'ok';
  return r >= 0.75 ? 'close' : 'behind';
}

export interface NudgeInput {
  now: Date;
  /** window start, 'HH:MM' */
  at: string;
  /** window end, 'HH:MM'; null or undefined means 21:00 */
  until?: string | null;
  /** minutes between reminders */
  every: number;
  /** maximum reminders per day */
  max: number;
  /** reminders already sent today */
  count: number;
  /** epoch ms of the last reminder, 0 if none */
  last: number;
  /** seconds studied today */
  secs: number;
  /** seconds of study that count as "started" */
  minSecs: number;
  running: boolean;
}

/** Should the study reminder fire now? */
export function shouldNudge(o: NudgeInput): boolean {
  const from = minutesOf(o.at);
  const to = minutesOf(o.until ?? '21:00');
  if (from === null) return false;
  const mins = o.now.getHours() * 60 + o.now.getMinutes();
  if (mins < from) return false;
  if (to !== null && mins >= to) return false;
  if (o.running) return false;
  if (o.secs >= Math.max(60, o.minSecs)) return false;
  if (o.count >= o.max) return false;
  if (o.last && o.now.getTime() - o.last < o.every * 60000) return false;
  return true;
}
