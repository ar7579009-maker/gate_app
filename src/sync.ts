// Sync between the phone's SQLite store and the cloud tables the desktop app uses.
// Rules:
// - Lectures: last write wins by time. A local change is pushed only if it is newer than the cloud row.
//   Ties go to the cloud. Only the latest local change per lecture is sent.
// - Sessions: write once. A session id is never changed, so pushing is an idempotent upsert.
// - Mocks stay on the phone for now (the desktop has no mocks table yet).
// Each step acknowledges the outbox only after the cloud accepted the write, so a dropped connection just retries.
import { rules } from '@gate-cc/core';
import type { OutboxRow, SessionRow, Store } from './store.js';

export interface RemoteLecture {
  lec_key: string;
  done: boolean | null;
  updated_at: string;
  deleted?: boolean;
}

export interface RemoteSession {
  id: string;
  subject: string;
  block: string | null;
  day: string;
  start_ms: number;
  seconds: number;
  mode: string;
  timer_mode: string | null;
  updated_at: string;
  deleted?: boolean;
}

export interface LectureUpsert {
  lec_key: string;
  done: boolean;
  updated_at: string;
}

export interface SessionUpsert {
  id: string;
  subject: string;
  block: string;
  day: string;
  start_ms: number;
  seconds: number;
  mode: 'up';
  timer_mode: SessionRow['mode'];
  updated_at: string;
}

/** The cloud side. The Supabase adapter (remote.ts) implements it; tests use a fake. */
export interface Remote {
  fetchLectures(): Promise<RemoteLecture[]>;
  fetchSessions(): Promise<RemoteSession[]>;
  upsertLectures(rows: LectureUpsert[]): Promise<void>;
  upsertSessions(rows: SessionUpsert[]): Promise<void>;
}

export interface SyncReport {
  pulledLectures: number;
  pulledSessions: number;
  pushedLectures: number;
  pushedSessions: number;
}

interface LecturePayload {
  id: string;
  done: boolean;
  at: number;
}

/** True if a local change made at `localAt` (epoch ms) should replace the cloud row. Ties go to the cloud. */
export function localWins(localAt: number, remoteUpdatedAt: string | undefined): boolean {
  if (remoteUpdatedAt === undefined) return true;
  const r = Date.parse(remoteUpdatedAt);
  return Number.isFinite(r) ? localAt > r : true;
}

export function sessionUpsert(s: SessionRow, nowIso: string): SessionUpsert {
  return {
    id: s.id,
    subject: s.subject,
    block: s.block,
    day: s.day,
    start_ms: s.startedAt,
    seconds: s.seconds,
    mode: 'up',
    timer_mode: s.mode,
    updated_at: nowIso,
  };
}

/** Keeps only the newest pending lecture change per id; older ones are acknowledged without sending. */
export function latestLectureChanges(pending: OutboxRow[]): { keep: OutboxRow[]; superseded: number[] } {
  const latest = new Map<string, number>();
  for (const p of pending) {
    if (p.kind !== 'lecture') continue;
    const v = JSON.parse(p.payload) as LecturePayload;
    latest.set(v.id, p.seq);
  }
  const keep: OutboxRow[] = [];
  const superseded: number[] = [];
  for (const p of pending) {
    if (p.kind !== 'lecture') {
      keep.push(p);
      continue;
    }
    const v = JSON.parse(p.payload) as LecturePayload;
    if (latest.get(v.id) === p.seq) keep.push(p);
    else superseded.push(p.seq);
  }
  return { keep, superseded };
}

/** One full sync pass: pull the cloud, then push what is pending. Throws if the cloud is unreachable. */
export async function syncOnce(store: Store, remote: Remote, nowMs: () => number = Date.now): Promise<SyncReport> {
  const report: SyncReport = { pulledLectures: 0, pulledSessions: 0, pushedLectures: 0, pushedSessions: 0 };

  // 1. pull lectures: apply cloud rows that are newer than what the phone has
  const remoteLec = await remote.fetchLectures();
  const remoteById = new Map(remoteLec.map((r) => [r.lec_key, r]));
  const localTimes = await store.lectureTimes();
  for (const r of remoteLec) {
    const at = Date.parse(r.updated_at);
    if (!Number.isFinite(at)) continue;
    const local = localTimes[r.lec_key];
    if (!local || at > local.at) {
      await store.applyRemoteLecture(r.lec_key, !r.deleted && r.done === true, at);
      report.pulledLectures++;
    }
  }

  // 2. pull sessions the phone does not have yet
  const have = new Set((await store.allSessions()).map((s) => s.id));
  for (const r of await remote.fetchSessions()) {
    if (r.deleted || have.has(r.id)) continue;
    await store.applyRemoteSession({
      id: r.id,
      subject: r.subject,
      block: r.block ?? 'Core',
      day: r.day,
      seconds: Math.max(0, Math.round(r.seconds)),
      mode: rules.timerMode(r.timer_mode),
      startedAt: Number(r.start_ms) || 0,
    });
    report.pulledSessions++;
  }

  // 3. push: lectures that are newer than the cloud, and every pending session
  const pending = await store.outboxPending();
  const { keep, superseded } = latestLectureChanges(pending);
  const nowIso = new Date(nowMs()).toISOString();
  const lecUp: LectureUpsert[] = [];
  const sessUp: SessionUpsert[] = [];
  const ackLocalOnly: number[] = [...superseded];
  const lecSeqs: number[] = [];
  const sessSeqs: number[] = [];

  for (const p of keep) {
    if (p.kind === 'lecture') {
      const v = JSON.parse(p.payload) as LecturePayload;
      if (localWins(v.at, remoteById.get(v.id)?.updated_at)) {
        lecUp.push({ lec_key: v.id, done: v.done, updated_at: new Date(v.at).toISOString() });
        lecSeqs.push(p.seq);
      } else {
        ackLocalOnly.push(p.seq);
      }
    } else if (p.kind === 'session') {
      sessUp.push(sessionUpsert(JSON.parse(p.payload) as SessionRow, nowIso));
      sessSeqs.push(p.seq);
    }
    // other kinds (mocks) stay pending until the desktop has a table for them
  }

  if (lecUp.length > 0) {
    await remote.upsertLectures(lecUp);
    report.pushedLectures = lecUp.length;
  }
  if (sessUp.length > 0) {
    await remote.upsertSessions(sessUp);
    report.pushedSessions = sessUp.length;
  }
  await store.ackOutbox([...ackLocalOnly, ...lecSeqs, ...sessSeqs]);
  return report;
}
