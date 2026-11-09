import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store.js';
import {
  latestLectureChanges,
  localWins,
  syncOnce,
  type LectureUpsert,
  type Remote,
  type RemoteLecture,
  type RemoteSession,
  type SessionUpsert,
} from '../src/sync.js';

class FakeRemote implements Remote {
  lectures: RemoteLecture[] = [];
  sessions: RemoteSession[] = [];
  failNext = false;
  lecWrites: LectureUpsert[] = [];
  sessWrites: SessionUpsert[] = [];

  async fetchLectures() {
    return this.lectures.map((r) => ({ ...r }));
  }
  async fetchSessions() {
    return this.sessions.map((r) => ({ ...r }));
  }
  private check() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('offline');
    }
  }
  async upsertLectures(rows: LectureUpsert[]) {
    this.check();
    this.lecWrites.push(...rows);
    for (const r of rows) {
      const row = { lec_key: r.lec_key, done: r.done, updated_at: r.updated_at };
      const i = this.lectures.findIndex((x) => x.lec_key === r.lec_key);
      if (i >= 0) this.lectures[i] = row;
      else this.lectures.push(row);
    }
  }
  async upsertSessions(rows: SessionUpsert[]) {
    this.check();
    this.sessWrites.push(...rows);
  }
}

const T0 = Date.parse('2026-11-09T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('localWins', () => {
  it('local is pushed only when strictly newer; ties and missing times go to the cloud', () => {
    expect(localWins(T0 + 1, iso(T0))).toBe(true);
    expect(localWins(T0, iso(T0))).toBe(false);
    expect(localWins(T0 - 1, iso(T0))).toBe(false);
    expect(localWins(T0, undefined)).toBe(true);
  });
});

describe('latestLectureChanges', () => {
  it('keeps only the newest pending change per lecture', () => {
    const pending = [
      { seq: 1, kind: 'lecture', payload: JSON.stringify({ id: 'A', done: true, at: 1 }) },
      { seq: 2, kind: 'lecture', payload: JSON.stringify({ id: 'A', done: false, at: 2 }) },
      { seq: 3, kind: 'mock', payload: '{}' },
    ];
    const r = latestLectureChanges(pending);
    expect(r.superseded).toEqual([1]);
    expect(r.keep.map((p) => p.seq)).toEqual([2, 3]);
  });
});

describe('syncOnce', () => {
  it('pulls a newer cloud tick and does not push it back', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    await store.setLectureDone('A', false, T0);
    await syncOnce(store, remote);
    remote.lectures = [{ lec_key: 'A', done: true, updated_at: iso(T0 + 5000) }];
    const before = remote.lecWrites.length;
    const rep = await syncOnce(store, remote);
    expect(rep.pulledLectures).toBe(1);
    expect(await store.lectureDone()).toEqual({ A: T0 + 5000 });
    expect(remote.lecWrites.length).toBe(before);
    expect(await store.outboxCount()).toBe(0);
  });

  it('pushes a newer local tick and clears the outbox', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    remote.lectures = [{ lec_key: 'B', done: false, updated_at: iso(T0) }];
    await store.setLectureDone('B', true, T0 + 1000);
    const rep = await syncOnce(store, remote, () => T0 + 2000);
    expect(rep.pushedLectures).toBe(1);
    expect(remote.lectures.find((x) => x.lec_key === 'B')?.done).toBe(true);
    expect(await store.outboxCount()).toBe(0);
  });

  it('a local tick older than the cloud row is dropped, not pushed', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    remote.lectures = [{ lec_key: 'C', done: false, updated_at: iso(T0 + 9000) }];
    await store.setLectureDone('C', true, T0);
    const rep = await syncOnce(store, remote);
    expect(rep.pushedLectures).toBe(0);
    expect(remote.lecWrites).toHaveLength(0);
    expect(await store.lectureDone()).toEqual({});
    expect(await store.outboxCount()).toBe(0);
  });

  it('several ticks on one lecture are sent once, with the latest value', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    await store.setLectureDone('D', true, T0 + 1);
    await store.setLectureDone('D', false, T0 + 2);
    await syncOnce(store, remote);
    expect(remote.lecWrites).toEqual([{ lec_key: 'D', done: false, updated_at: iso(T0 + 2) }]);
  });

  it('a failed push keeps the outbox so the next sync retries', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    await store.addSession({ id: 's1', subject: 'DS', block: 'Core', day: '2026-11-09', seconds: 600, mode: 'Learn', startedAt: T0 });
    remote.failNext = true;
    await expect(syncOnce(store, remote)).rejects.toThrow('offline');
    expect(await store.outboxCount()).toBe(1);
    const rep = await syncOnce(store, remote);
    expect(rep.pushedSessions).toBe(1);
    expect(await store.outboxCount()).toBe(0);
  });

  it('pulls cloud sessions once, and skips deleted ones', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    remote.sessions = [
      { id: 'desk1', subject: 'Maths', block: 'Maths', day: '2026-11-08', start_ms: T0, seconds: 1800, mode: 'down', timer_mode: 'Revise', updated_at: iso(T0), deleted: false },
      { id: 'gone', subject: 'X', block: null, day: '2026-11-08', start_ms: T0, seconds: 60, mode: 'up', timer_mode: null, updated_at: iso(T0), deleted: true },
    ];
    expect((await syncOnce(store, remote)).pulledSessions).toBe(1);
    expect((await syncOnce(store, remote)).pulledSessions).toBe(0);
    const all = await store.allSessions();
    expect(all.map((s) => s.id)).toEqual(['desk1']);
    expect(all[0]?.mode).toBe('Revise');
    expect(await store.outboxCount()).toBe(0);
  });

  it('a session pushed to the cloud is not duplicated on the next pull', async () => {
    const store = new MemoryStore();
    const remote = new FakeRemote();
    await store.addSession({ id: 'p1', subject: 'DS', block: 'Core', day: '2026-11-09', seconds: 300, mode: 'Learn', startedAt: T0 });
    await syncOnce(store, remote);
    remote.sessions = [{ id: 'p1', subject: 'DS', block: 'Core', day: '2026-11-09', start_ms: T0, seconds: 300, mode: 'up', timer_mode: 'Learn', updated_at: iso(T0), deleted: false }];
    expect((await syncOnce(store, remote)).pulledSessions).toBe(0);
    expect(await store.allSessions()).toHaveLength(1);
  });
});
