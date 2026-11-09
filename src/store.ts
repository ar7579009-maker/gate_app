// Storage for the companion app. One interface, two backends:
// - SqliteStore: on-device SQLite on Android (the source of truth on the phone)
// - MemoryStore: browser preview and tests
// Local writes also land in the outbox table. Sync pushes the outbox and then clears what was sent.
// Remote changes are applied with applyRemote*, which never writes to the outbox (no echo loops).

export type TimerModeName = 'Learn' | 'Practice' | 'Revise';

export interface SessionRow {
  id: string;
  subject: string;
  block: string;
  day: string;
  seconds: number;
  mode: TimerModeName;
  startedAt: number;
}

export interface MockRow {
  id: string;
  day: string;
  name: string;
  marks: number;
  subjectMarks: Record<string, number>;
}

export interface OutboxRow {
  seq: number;
  kind: string;
  payload: string;
}

export interface LectureTime {
  done: boolean;
  at: number;
}

export interface Store {
  init(): Promise<void>;
  addSession(s: SessionRow): Promise<void>;
  sessionsOn(day: string): Promise<SessionRow[]>;
  allSessions(): Promise<SessionRow[]>;
  applyRemoteSession(s: SessionRow): Promise<void>;
  setLectureDone(id: string, done: boolean, at: number): Promise<void>;
  applyRemoteLecture(id: string, done: boolean, at: number): Promise<void>;
  lectureDone(): Promise<Record<string, number>>;
  lectureTimes(): Promise<Record<string, LectureTime>>;
  addMock(m: MockRow): Promise<void>;
  mocks(): Promise<MockRow[]>;
  outboxPending(): Promise<OutboxRow[]>;
  ackOutbox(seqs: number[]): Promise<void>;
  outboxCount(): Promise<number>;
  close(): Promise<void>;
}

export const SCHEMA_VERSION = 1;

// SQL used by SqliteStore. Kept here so the schema can be read and tested without the phone.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  block TEXT NOT NULL,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds >= 0),
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_day ON sessions(day);
CREATE TABLE IF NOT EXISTS lecture_done (
  id TEXT PRIMARY KEY,
  done INTEGER NOT NULL CHECK (done IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mocks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  marks REAL NOT NULL,
  subject_marks TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export class MemoryStore implements Store {
  private sessions: SessionRow[] = [];
  private lectures: Record<string, LectureTime> = {};
  private mockList: MockRow[] = [];
  private outbox: OutboxRow[] = [];
  private seq = 0;

  async init(): Promise<void> {}

  private queue(kind: string, payload: unknown): void {
    this.seq++;
    this.outbox.push({ seq: this.seq, kind, payload: JSON.stringify(payload) });
  }

  async addSession(s: SessionRow): Promise<void> {
    this.sessions.push(s);
    this.queue('session', s);
  }

  async applyRemoteSession(s: SessionRow): Promise<void> {
    if (!this.sessions.some((x) => x.id === s.id)) this.sessions.push(s);
  }

  async sessionsOn(day: string): Promise<SessionRow[]> {
    return this.sessions.filter((s) => s.day === day);
  }

  async allSessions(): Promise<SessionRow[]> {
    return [...this.sessions];
  }

  async setLectureDone(id: string, done: boolean, at: number): Promise<void> {
    this.lectures[id] = { done, at };
    this.queue('lecture', { id, done, at });
  }

  async applyRemoteLecture(id: string, done: boolean, at: number): Promise<void> {
    this.lectures[id] = { done, at };
  }

  async lectureDone(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(this.lectures)) if (v.done) out[id] = v.at;
    return out;
  }

  async lectureTimes(): Promise<Record<string, LectureTime>> {
    return { ...this.lectures };
  }

  async addMock(m: MockRow): Promise<void> {
    this.mockList.push(m);
    this.queue('mock', m);
  }

  async mocks(): Promise<MockRow[]> {
    return [...this.mockList];
  }

  async outboxPending(): Promise<OutboxRow[]> {
    return [...this.outbox];
  }

  async ackOutbox(seqs: number[]): Promise<void> {
    const drop = new Set(seqs);
    this.outbox = this.outbox.filter((r) => !drop.has(r.seq));
  }

  async outboxCount(): Promise<number> {
    return this.outbox.length;
  }

  async close(): Promise<void> {}
}

/** Minimal surface of the SQLite plugin connection (execute, run, query, open, close). */
export interface SqlDb {
  open(): Promise<void>;
  execute(sql: string): Promise<unknown>;
  run(sql: string, values?: unknown[]): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<{ values?: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

const SESSION_COLS = 'id, subject, block, day, seconds, mode, started_at AS startedAt';

export class SqliteStore implements Store {
  constructor(private readonly db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.open();
    await this.db.execute(SCHEMA_SQL);
  }

  private run(sql: string, values: unknown[]): Promise<unknown> {
    return this.db.run(sql, values);
  }

  private async queue(kind: string, payload: unknown): Promise<void> {
    await this.run('INSERT INTO outbox (kind, payload, created_at) VALUES (?, ?, ?)', [
      kind,
      JSON.stringify(payload),
      Date.now(),
    ]);
  }

  async addSession(s: SessionRow): Promise<void> {
    await this.run(
      'INSERT INTO sessions (id, subject, block, day, seconds, mode, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.subject, s.block, s.day, s.seconds, s.mode, s.startedAt],
    );
    await this.queue('session', s);
  }

  async applyRemoteSession(s: SessionRow): Promise<void> {
    await this.run(
      'INSERT OR IGNORE INTO sessions (id, subject, block, day, seconds, mode, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [s.id, s.subject, s.block, s.day, s.seconds, s.mode, s.startedAt],
    );
  }

  async sessionsOn(day: string): Promise<SessionRow[]> {
    const r = await this.db.query(`SELECT ${SESSION_COLS} FROM sessions WHERE day = ? ORDER BY started_at`, [day]);
    return (r.values ?? []) as unknown as SessionRow[];
  }

  async allSessions(): Promise<SessionRow[]> {
    const r = await this.db.query(`SELECT ${SESSION_COLS} FROM sessions ORDER BY started_at`);
    return (r.values ?? []) as unknown as SessionRow[];
  }

  async setLectureDone(id: string, done: boolean, at: number): Promise<void> {
    await this.applyRemoteLecture(id, done, at);
    await this.queue('lecture', { id, done, at });
  }

  async applyRemoteLecture(id: string, done: boolean, at: number): Promise<void> {
    await this.run(
      'INSERT INTO lecture_done (id, done, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at',
      [id, done ? 1 : 0, at],
    );
  }

  async lectureDone(): Promise<Record<string, number>> {
    const r = await this.db.query('SELECT id, updated_at AS at FROM lecture_done WHERE done = 1');
    const out: Record<string, number> = {};
    for (const row of r.values ?? []) out[String(row.id)] = Number(row.at);
    return out;
  }

  async lectureTimes(): Promise<Record<string, LectureTime>> {
    const r = await this.db.query('SELECT id, done, updated_at AS at FROM lecture_done');
    const out: Record<string, LectureTime> = {};
    for (const row of r.values ?? []) out[String(row.id)] = { done: Number(row.done) === 1, at: Number(row.at) };
    return out;
  }

  async addMock(m: MockRow): Promise<void> {
    await this.run('INSERT INTO mocks (id, day, name, marks, subject_marks) VALUES (?, ?, ?, ?, ?)', [
      m.id,
      m.day,
      m.name,
      m.marks,
      JSON.stringify(m.subjectMarks),
    ]);
    await this.queue('mock', m);
  }

  async mocks(): Promise<MockRow[]> {
    const r = await this.db.query('SELECT id, day, name, marks, subject_marks FROM mocks ORDER BY day, id');
    return (r.values ?? []).map((row) => ({
      id: String(row.id),
      day: String(row.day),
      name: String(row.name),
      marks: Number(row.marks),
      subjectMarks: JSON.parse(String(row.subject_marks)) as Record<string, number>,
    }));
  }

  async outboxPending(): Promise<OutboxRow[]> {
    const r = await this.db.query('SELECT seq, kind, payload FROM outbox ORDER BY seq');
    return (r.values ?? []).map((row) => ({ seq: Number(row.seq), kind: String(row.kind), payload: String(row.payload) }));
  }

  async ackOutbox(seqs: number[]): Promise<void> {
    if (seqs.length === 0) return;
    const marks = seqs.map(() => '?').join(', ');
    await this.run(`DELETE FROM outbox WHERE seq IN (${marks})`, seqs);
  }

  async outboxCount(): Promise<number> {
    const r = await this.db.query('SELECT COUNT(*) AS n FROM outbox');
    return Number(r.values?.[0]?.n ?? 0);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
