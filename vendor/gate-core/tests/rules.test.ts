import { describe, expect, it } from 'vitest';
import { pruneTombs, repairSessionDays, sanitizeState, sessionFromRow, timerMode, validateBackup } from '../src/rules.js';

describe('timerMode / sessionFromRow', () => {
  it('unknown modes become Learn; old rows without a mode column get Learn', () => {
    expect(timerMode('Revise')).toBe('Revise');
    expect(timerMode('Nap')).toBe('Learn');
    const s = sessionFromRow({ id: '1', subject: 'DS', day: '2026-10-20', seconds: 61.4, mode: 'up' }, () => 'Core');
    expect(s).toMatchObject({ block: 'Core', mode: 'Learn', kind: 'stopwatch', seconds: 61 });
  });
});

describe('repairSessionDays', () => {
  it('moves a session to the local day its timer started', () => {
    const start = new Date(2026, 9, 20, 10, 0).getTime();
    const rows = [{ id: 'a', day: '2026-10-19', start }, { id: 'b', day: '2026-10-20', start: 0 }];
    expect(repairSessionDays(rows)).toEqual(['a']);
    expect(rows[0]!.day).toBe('2026-10-20');
  });
});

describe('pruneTombs', () => {
  it('keeps recent deletions, drops old ones, stamps records without a time', () => {
    const now = 1_000_000;
    const out = pruneTombs({ old: { _at: 0 }, fresh: { _at: now - 10 }, untimed: {}, bad: 5 }, now, 100);
    expect(Object.keys(out).sort()).toEqual(['fresh', 'untimed']);
    expect(out.untimed!._at).toBe(now);
  });
});

describe('validateBackup', () => {
  const good = JSON.stringify({ app: 'gate-command-center', savedAt: 'x', version: '2.5.1', state: { sessions: [] } });
  it('accepts a backup of this app', () => expect(validateBackup(good).ok).toBe(true));
  it('rejects empty, non-JSON, foreign and damaged backups', () => {
    expect(validateBackup('').ok).toBe(false);
    expect(validateBackup('{nope').ok).toBe(false);
    expect(validateBackup(JSON.stringify({ app: 'other', state: {} }))).toMatchObject({ ok: false });
    expect(validateBackup(JSON.stringify({ app: 'gate-command-center', state: { sessions: {} } }))).toMatchObject({ ok: false });
    expect(validateBackup(JSON.stringify({ app: 'gate-command-center', state: { lec: [] } }))).toMatchObject({ ok: false });
  });
  it('rejects a backup over the size limit', () => {
    expect(validateBackup(good, { maxBytes: 10 }).ok).toBe(false);
  });
});

describe('sanitizeState', () => {
  it('drops bad sessions and resets bad fields, reporting what was skipped', () => {
    const { state, dropped } = sanitizeState({
      sessions: [{ id: 'a', day: '2026-10-20', seconds: 5 }, { id: 'b', day: 'nope', seconds: 5 }],
      lec: 'broken',
      w: { x: 1 },
      order: [{ id: 'pinned', on: true }],
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.lec).toEqual({});
    expect(state.w).toEqual({ x: 1 });
    expect(state.order).toEqual([{ id: 'pinned', on: true }]);
    expect(dropped).toContain('1 session row(s)');
    expect(dropped).toContain('lec');
  });
  it('removes a broken field that has no fallback', () => {
    const { state } = sanitizeState({ marks: { a: 'x' } });
    expect('marks' in state).toBe(false);
  });
});
