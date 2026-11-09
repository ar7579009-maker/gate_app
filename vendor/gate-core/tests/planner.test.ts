import { describe, expect, it } from 'vitest';
import { fill, finish, keepSplit, reflow, simulate, type Job, type Lecture } from '../src/planner.js';

const q = (name: string, hs: number[]): Lecture[] => hs.map((h, i) => ({ id: name + i, h }));

describe('fill', () => {
  it('plans every lecture once, in order', () => {
    const days = [1, 2, 3].map((n) => ({ date: 'd' + n, alloc: [{ name: 'A', hours: 2 }] }));
    expect(fill(days, { A: q('A', [1, 1, 1, 1, 1]) })).toEqual({ d1: ['A0', 'A1'], d2: ['A2', 'A3'], d3: ['A4'] });
  });
  it('never splits a lecture; overshoot is taken from the next day', () => {
    const days = [{ date: 'd1', alloc: [{ name: 'A', hours: 1 }] }, { date: 'd2', alloc: [{ name: 'A', hours: 2 }] }];
    expect(fill(days, { A: q('A', [1.5, 1.5, 1.5]) })).toEqual({ d1: ['A0'], d2: ['A1'] });
  });
  it('skips subjects without a queue; empty days give empty lists', () => {
    const days = [{ date: 'd1', alloc: [{ name: 'X', hours: 3 }] }, { date: 'd2', alloc: [] }];
    expect(fill(days, { A: q('A', [1]) })).toEqual({ d1: [], d2: [] });
  });
  it('does not invent lectures after the last day', () => {
    const queues = { A: q('A', [1, 1, 1]) };
    expect(fill([{ date: 'd1', alloc: [{ name: 'A', hours: 1 }] }], queues)).toEqual({ d1: ['A0'] });
    expect(queues.A).toHaveLength(2);
  });
});

const LECS = Array.from({ length: 10 }, (_, i) => 'A' + i);
const opts = { lanes: 1, daily: 2, shares: [1], sunOff: false, leftover: false, start: '2026-12-02' };
const jobsFor = (ids: string[], skip = new Set<string>()): Job[] => [
  { key: 'A', name: 'A', hours: ids.filter((i) => !skip.has(i)).length, marks: 1, block: 'Core' },
];
const isValid = (id: string) => LECS.includes(id);

describe('simulate', () => {
  it('gives the same finish for a plain run', () => {
    const r = simulate(jobsFor(LECS), { ...opts, start: '2026-12-02' });
    expect(r.done).toBe(true);
    expect(r.finish).toBe('2026-12-06');
  });
});

describe('replan', () => {
  it('early ticks pull the rest forward and the freed hours are used', () => {
    const old = {
      '2026-12-02': ['A0', 'A1'], '2026-12-03': ['A2', 'A3'], '2026-12-04': ['A4', 'A5'],
      '2026-12-05': ['A6', 'A7'], '2026-12-06': ['A8', 'A9'],
    };
    const done = new Set(['A4', 'A5', 'A6', 'A7']);
    const isDone = (id: string) => done.has(id);
    const split = keepSplit(old, '2026-12-02', isDone, isValid);
    const queues = { A: LECS.filter((id) => !done.has(id) && !split.kept.has(id)).map((id) => ({ id, h: 1 })) };
    const r = reflow(split, { start: '2026-12-03', opts, js: jobsFor(LECS, new Set([...done, ...split.kept])), queues });
    expect(r.unplaced).toBe(0);
    expect(r.days['2026-12-03']).toEqual(['A2', 'A3']);
    expect(r.days['2026-12-04']!.filter((id) => !done.has(id))).toEqual(['A8', 'A9']);
    expect(finish(r.days, isValid, isDone)).toBe('2026-12-04');
  });

  it('today and ticked lectures never move; unticked past lectures are caught up', () => {
    const old = { '2026-12-01': ['A0', 'A1'], '2026-12-02': ['A2', 'A3'], '2026-12-03': ['A4', 'A5'] };
    const done = new Set(['A0', 'A4']);
    const split = keepSplit(old, '2026-12-02', (id) => done.has(id), isValid);
    expect(split.days['2026-12-02']).toEqual(['A2', 'A3']);
    expect(split.days['2026-12-01']).toEqual(['A0']);
    expect(split.days['2026-12-03']).toEqual(['A4']);
    expect(split.kept.has('A2') && split.kept.has('A4') && !split.kept.has('A1')).toBe(true);
  });

  it('drops lectures that are no longer valid from kept days', () => {
    const split = keepSplit({ '2026-12-02': ['A0', 'GONE'] }, '2026-12-02', () => true, (id) => id !== 'GONE');
    expect(split.days['2026-12-02']).toEqual(['A0']);
  });

  it('a new lecture queued in chapter order lands before the next chapter', () => {
    const split = keepSplit({}, '2026-12-01', () => false, () => true);
    const queues = { A: [{ id: 'A0', h: 1 }, { id: 'A1', h: 1 }, { id: 'NEW', h: 1 }, { id: 'A2', h: 1 }] };
    const r = reflow(split, { start: '2026-12-02', opts, js: jobsFor(['A0', 'A1', 'NEW', 'A2']), queues });
    expect(Object.values(r.days).flat()).toEqual(['A0', 'A1', 'NEW', 'A2']);
  });
});

describe('finish', () => {
  it('is the last day with unticked work, ignoring ticked-only and empty days', () => {
    const days = { '2026-12-02': ['A0'], '2026-12-03': [], '2026-12-04': ['A1'], '2026-12-05': ['A9'] };
    expect(finish(days, () => true, (id) => id === 'A9')).toBe('2026-12-04');
    expect(finish(days, () => true)).toBe('2026-12-05');
    expect(finish({ '2026-12-02': ['A9'] }, () => true, () => true)).toBe('2026-12-02');
    expect(finish({}, () => true)).toBeNull();
  });
});
