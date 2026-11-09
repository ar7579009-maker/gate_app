// Planner core: the scheduler's day simulation, the per-day lecture lists, and the re-plan of future days.
// Pure functions, no access to app state.
import { addDays } from './dates.js';

export interface Job {
  key: string;
  name: string;
  hours: number;
  marks?: number;
  block?: string;
}

export interface Lecture {
  id: string;
  h: number;
}

export interface SimOptions {
  lanes: number;
  daily: number;
  shares: ReadonlyArray<number>;
  sunOff: boolean;
  leftover: boolean;
  start: string;
}

export interface Allocation {
  name: string;
  hours: number;
  share: number;
}

export interface SimDay {
  date: string;
  off: boolean;
  alloc: Allocation[];
}

export interface SimResult {
  days: SimDay[];
  finish: string | null;
  done: boolean;
}

const MAX_DAYS = 900;
const MAX_PASSES = 6;
const MAX_LANES = 4;

/**
 * Fills study lanes day by day. Each lane works one subject at a time, and the day's hours are split
 * between active lanes by their shares. Off-days (Sundays when sunOff) are listed but get no work.
 */
export function simulate(jobs: ReadonlyArray<Job>, o: SimOptions): SimResult {
  const queue = jobs.map((j) => ({ ...j, rem: j.hours }));
  const lanes = Math.min(MAX_LANES, Math.max(1, o.lanes));
  const slots: Array<(typeof queue)[number] | null> = Array.from({ length: lanes }, () => null);
  const shares = Array.from({ length: lanes }, (_, i) => {
    const s = o.shares[i];
    return s !== undefined && s > 0 ? s : 1;
  });
  const out: SimDay[] = [];
  let finish: string | null = null;

  for (let d = 0; (queue.length > 0 || slots.some(Boolean)) && d < MAX_DAYS; d++) {
    const date = addDays(o.start, d);
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const rec: SimDay = { date, off: o.sunOff && dayOfWeek === 0, alloc: [] };
    out.push(rec);
    if (rec.off) continue;

    let budget = o.daily || 0;
    const used = new Map<string, Allocation>();
    for (let pass = 0; pass < (o.leftover ? MAX_PASSES : 1) && budget > 1e-9; pass++) {
      for (let i = 0; i < lanes; i++) {
        const s = slots[i];
        if (s && s.rem <= 1e-9) slots[i] = null;
      }
      for (let i = 0; i < lanes; i++) {
        if (!slots[i] && queue.length > 0) slots[i] = queue.shift() ?? null;
      }
      const active = slots
        .map((j, i) => (j && j.rem > 1e-9 ? i : -1))
        .filter((i) => i >= 0);
      if (active.length === 0) break;

      const weight = active.reduce((a, i) => a + (shares[i] ?? 1), 0);
      const room = budget;
      for (const i of active) {
        const j = slots[i];
        if (!j) continue;
        const w = shares[i] ?? 1;
        const use = Math.min((room * w) / weight, j.rem, budget);
        if (use <= 1e-9) continue;
        j.rem -= use;
        budget -= use;
        const u = used.get(j.key) ?? { name: j.name, hours: 0, share: Math.round((w / weight) * 100) };
        u.hours += use;
        used.set(j.key, u);
      }
    }
    rec.alloc = [...used.values()];
    if (rec.alloc.length > 0) finish = date;
    for (let i = 0; i < lanes; i++) {
      const s = slots[i];
      if (s && s.rem <= 1e-9) slots[i] = null;
    }
  }
  return { days: out, finish, done: queue.length === 0 && !slots.some(Boolean) };
}

/**
 * Hands each day its lectures in order, per subject. A lecture is never split. A day may run a little
 * over or under; the difference carries to the next day for that subject. Queues are consumed in place.
 */
export function fill(
  simDays: ReadonlyArray<{ date: string; alloc: ReadonlyArray<{ name: string; hours: number }> }>,
  queues: Record<string, Lecture[]>,
): Record<string, string[]> {
  const credit: Record<string, number> = {};
  const out: Record<string, string[]> = {};
  for (const d of simDays) {
    const ids: string[] = [];
    for (const a of d.alloc) {
      if (!Object.prototype.hasOwnProperty.call(queues, a.name)) continue;
      const q = queues[a.name];
      if (!q) continue;
      let b = (credit[a.name] ?? 0) + a.hours;
      while (b > 1e-9 && q.length > 0) {
        const x = q.shift();
        if (!x) break;
        ids.push(x.id);
        b -= x.h;
      }
      credit[a.name] = b;
    }
    out[d.date] = ids;
  }
  return out;
}

export interface Split {
  days: Record<string, string[]>;
  kept: Set<string>;
}

/**
 * What stays where it is before a re-plan.
 * - today: every lecture stays, done or not (today never moves)
 * - days before today: only ticked lectures stay; unticked ones go back into the queue (catch-up)
 * - days after today: only ticked lectures stay; the rest is re-planned
 */
export function keepSplit(
  oldDays: Record<string, string[]>,
  today: string,
  isDone: (id: string) => boolean,
  isValid: (id: string) => boolean,
): Split {
  const days: Record<string, string[]> = {};
  const kept = new Set<string>();
  for (const d of Object.keys(oldDays).sort()) {
    const ids = (oldDays[d] ?? []).filter(isValid);
    const keep = d === today ? ids : ids.filter(isDone);
    days[d] = keep;
    for (const id of keep) kept.add(id);
  }
  return { days, kept };
}

export interface ReflowInput {
  start: string;
  opts: Omit<SimOptions, 'start'>;
  js: ReadonlyArray<Job>;
  queues: Record<string, Lecture[]>;
}

/**
 * Rebuilds the days after today. Nothing is dropped: whatever cannot be placed is counted in `unplaced`.
 */
export function reflow(split: Split, o: ReflowInput): { days: Record<string, string[]>; unplaced: number } {
  const days: Record<string, string[]> = { ...split.days };
  const sim = simulate(o.js, { ...o.opts, start: o.start });
  const out = fill(sim.days, o.queues);
  for (const d of Object.keys(out)) days[d] = (days[d] ?? []).concat(out[d] ?? []);
  let unplaced = 0;
  for (const k of Object.keys(o.queues)) unplaced += o.queues[k]?.length ?? 0;
  return { days, unplaced };
}

/**
 * When the work still to do ends: the last day with an unticked lecture.
 * If everything is ticked, the last day with any lecture.
 */
export function finish(
  days: Record<string, string[]>,
  isValid: (id: string) => boolean,
  isDone?: (id: string) => boolean,
): string | null {
  const last = (test: (id: string) => boolean): string | null => {
    let r: string | null = null;
    for (const d of Object.keys(days)) {
      if ((days[d] ?? []).some(test) && (r === null || d > r)) r = d;
    }
    return r;
  };
  return last((id) => isValid(id) && !(isDone?.(id) ?? false)) ?? last(isValid);
}
