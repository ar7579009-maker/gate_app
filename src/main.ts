// Companion app shell: Today (lecture ticks and cloud sync), Timer (focus sessions) and Mocks (scores).
// Storage is injected, so the same screens run in the Android app (SQLite) and in the browser preview.
import { dayOf } from '@gate-cc/core';
import { FocusTimer } from './timer.js';
import { MemoryStore, type Store } from './store.js';
import { syncOnce, type SyncReport } from './sync.js';
import { makeClient, sendPin, SupabaseRemote, verifyPin } from './remote.js';
import type { SupabaseClient } from '@supabase/supabase-js';

type Tab = 'today' | 'timer' | 'mocks';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app element');

const env = import.meta.env as Record<string, string | undefined>;
const SUPABASE_URL = env['VITE_SUPABASE_URL'] ?? '';
const SUPABASE_KEY = env['VITE_SUPABASE_ANON_KEY'] ?? '';

async function createStore(): Promise<Store> {
  // The native SQLite plugin only exists inside the Android app. In a browser, fall back to memory.
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return new MemoryStore();
  const { SqliteStore } = await import('./sqlite-store.js');
  return SqliteStore.open('gate_companion');
}

const store = await createStore();
await store.init();
const timer = new FocusTimer();
let tab: Tab = 'today';
let subjectName = 'Data Structures';
const today = (): string => dayOf(Date.now());

// Cloud state. The client keeps the login between launches (supabase-js stores the session).
const client: SupabaseClient | null = SUPABASE_URL && SUPABASE_KEY ? makeClient(SUPABASE_URL, SUPABASE_KEY) : null;
let cloud: { uid: string; email: string } | null = null;
let pendingEmail = '';
let cloudMsg = client ? '' : 'Cloud is not configured in this build.';
let lastReport: SyncReport | null = null;
let syncing = false;

async function restoreLogin(): Promise<void> {
  if (!client) return;
  const { data } = await client.auth.getSession();
  const s = data.session;
  if (s) cloud = { uid: s.user.id, email: s.user.email ?? '' };
}

async function syncNow(): Promise<void> {
  if (!client || !cloud || syncing) return;
  syncing = true;
  cloudMsg = 'Syncing…';
  void render();
  try {
    lastReport = await syncOnce(store, new SupabaseRemote(client, cloud.uid));
    const r = lastReport;
    cloudMsg = `Synced: got ${r.pulledLectures + r.pulledSessions}, sent ${r.pushedLectures + r.pushedSessions} at ${new Date().toLocaleTimeString('en-GB')}`;
  } catch (e) {
    cloudMsg = `Sync failed, will retry: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    syncing = false;
    void render();
  }
}

function h(html: string): string {
  return html;
}

function cloudCard(): string {
  if (!client) return `<p class="muted small">${escapeHtml(cloudMsg)}</p>`;
  if (cloud) {
    return h(`
      <div class="card">
        <p class="small">Signed in as <strong>${escapeHtml(cloud.email)}</strong></p>
        <div class="row">
          <button id="sync-now">Sync now</button>
          <button id="sign-out" class="ghost">Sign out</button>
        </div>
        <p class="muted small">${escapeHtml(cloudMsg)}</p>
      </div>`);
  }
  return h(`
    <div class="card">
      <form id="send-pin" class="stack">
        <label class="field">Email <input name="email" type="email" required autocomplete="email" value="${escapeAttr(pendingEmail)}" /></label>
        <button type="submit">Send code</button>
      </form>
      <form id="verify-pin" class="stack">
        <label class="field">Code from email <input name="token" inputmode="numeric" autocomplete="one-time-code" /></label>
        <button type="submit" class="ghost">Sign in</button>
      </form>
      <p class="muted small">${escapeHtml(cloudMsg)}</p>
    </div>`);
}

async function renderToday(): Promise<string> {
  const done = await store.lectureDone();
  const doneCount = Object.keys(done).length;
  const todays = await store.sessionsOn(today());
  const secs = todays.reduce((a, s) => a + s.seconds, 0);
  const pending = await store.outboxCount();
  return h(`
    <section>
      <h2>Today</h2>
      <p class="muted">${doneCount} lectures ticked · ${Math.round(secs / 60)} min studied today · ${pending} waiting to sync</p>
      <label class="field">Lecture id
        <input id="lec-id" placeholder="e.g. DS-12" autocomplete="off" />
      </label>
      <div class="row">
        <button id="lec-tick">Tick</button>
        <button id="lec-untick" class="ghost">Untick</button>
      </div>
      <h3>Cloud</h3>
      ${cloudCard()}
    </section>`);
}

function renderTimer(): string {
  const running = timer.status === 'running';
  return h(`
    <section>
      <h2>Timer</h2>
      <p class="clock" id="clock">${fmt(timer.elapsedSeconds())}</p>
      <label class="field">Subject
        <input id="subject" value="${escapeAttr(subjectName)}" autocomplete="off" />
      </label>
      <div class="row">
        <button id="timer-toggle">${running ? 'Pause' : timer.status === 'paused' ? 'Resume' : 'Start'}</button>
        <button id="timer-stop" class="ghost">Save session</button>
      </div>
      <p class="muted small">Timer keeps counting after you leave the app, because it uses the clock.</p>
    </section>`);
}

async function renderMocks(): Promise<string> {
  const list = await store.mocks();
  const rows = list
    .map((m) => `<li><strong>${escapeHtml(m.name)}</strong> · ${escapeHtml(m.day)} · ${m.marks} marks</li>`)
    .join('');
  return h(`
    <section>
      <h2>Mocks</h2>
      <p class="muted small">Mocks stay on this phone for now.</p>
      <form id="mock-form" class="stack">
        <label class="field">Test name <input name="name" required autocomplete="off" /></label>
        <label class="field">Marks <input name="marks" type="number" step="0.5" min="0" required /></label>
        <button type="submit">Add mock</button>
      </form>
      <ul class="list">${rows || '<li class="muted">No mocks yet.</li>'}</ul>
    </section>`);
}

function fmt(total: number): string {
  const h2 = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(h2)}:${p(m)}:${p(s)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
const escapeAttr = escapeHtml;

async function render(): Promise<void> {
  const body = tab === 'today' ? await renderToday() : tab === 'timer' ? renderTimer() : await renderMocks();
  app!.innerHTML = `
    <main>${body}</main>
    <nav class="tabs">
      ${(['today', 'timer', 'mocks'] as Tab[])
        .map((t) => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${t[0]!.toUpperCase() + t.slice(1)}</button>`)
        .join('')}
    </nav>`;
  wire();
}

function wire(): void {
  app!.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset['tab'] as Tab;
      void render();
    }),
  );
  if (tab === 'today') {
    const input = document.getElementById('lec-id') as HTMLInputElement | null;
    const id = (): string => (input?.value ?? '').trim();
    document.getElementById('lec-tick')?.addEventListener('click', async () => {
      if (!id()) return;
      await store.setLectureDone(id(), true, Date.now());
      void render();
    });
    document.getElementById('lec-untick')?.addEventListener('click', async () => {
      if (!id()) return;
      await store.setLectureDone(id(), false, Date.now());
      void render();
    });
    document.getElementById('sync-now')?.addEventListener('click', () => void syncNow());
    document.getElementById('sign-out')?.addEventListener('click', async () => {
      await client?.auth.signOut();
      cloud = null;
      cloudMsg = 'Signed out. Local data stays on this phone.';
      void render();
    });
    document.getElementById('send-pin')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = String(new FormData(e.target as HTMLFormElement).get('email') ?? '').trim();
      if (!client || !email) return;
      pendingEmail = email;
      try {
        await sendPin(client, email);
        cloudMsg = 'Code sent. Check your email.';
      } catch (err) {
        cloudMsg = `Could not send code: ${err instanceof Error ? err.message : String(err)}`;
      }
      void render();
    });
    document.getElementById('verify-pin')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = String(new FormData(e.target as HTMLFormElement).get('token') ?? '').trim();
      if (!client || !token || !pendingEmail) return;
      try {
        const uid = await verifyPin(client, pendingEmail, token);
        cloud = { uid, email: pendingEmail };
        cloudMsg = 'Signed in.';
        void render();
        await syncNow();
        return;
      } catch (err) {
        cloudMsg = `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      void render();
    });
  }
  if (tab === 'timer') {
    document.getElementById('timer-toggle')?.addEventListener('click', () => {
      if (timer.status === 'running') timer.pause();
      else timer.begin();
      void render();
    });
    document.getElementById('timer-stop')?.addEventListener('click', async () => {
      const subject = (document.getElementById('subject') as HTMLInputElement | null)?.value.trim() || 'General';
      subjectName = subject;
      const startedAt = timer.sessionStart() || Date.now();
      const seconds = timer.stop();
      if (seconds > 0) {
        await store.addSession({
          id: `p${startedAt}`,
          subject,
          block: 'Core',
          day: dayOf(startedAt),
          seconds,
          mode: 'Learn',
          startedAt,
        });
      }
      void render();
    });
  }
  if (tab === 'mocks') {
    document.getElementById('mock-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = String(new FormData(f).get('name') ?? '').trim();
      const marks = Number(new FormData(f).get('marks'));
      if (!name || !Number.isFinite(marks)) return;
      await store.addMock({ id: `${Date.now()}`, day: today(), name, marks, subjectMarks: {} });
      void render();
    });
  }
}

// Tick the clock while the timer runs.
setInterval(() => {
  if (tab !== 'timer' || timer.status !== 'running') return;
  const el = document.getElementById('clock');
  if (el) el.textContent = fmt(timer.elapsedSeconds());
}, 1000);

// Sync when the app opens (if signed in and online), and again when the connection returns.
await restoreLogin();
window.addEventListener('online', () => void syncNow());
void render();
if (cloud && navigator.onLine) void syncNow();
