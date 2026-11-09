// Supabase adapter for the sync. Uses the same tables and login as the desktop app.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LectureUpsert, Remote, RemoteLecture, RemoteSession, SessionUpsert } from './sync.js';

export function makeClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
}

/** Email one-time code, the same sign-in the desktop app uses. */
export async function sendPin(c: SupabaseClient, email: string): Promise<void> {
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyPin(c: SupabaseClient, email: string, token: string): Promise<string> {
  const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  const uid = data.user?.id;
  if (!uid) throw new Error('Signed in, but no user id came back.');
  return uid;
}

export class SupabaseRemote implements Remote {
  constructor(
    private readonly c: SupabaseClient,
    private readonly uid: string,
  ) {}

  async fetchLectures(): Promise<RemoteLecture[]> {
    const { data, error } = await this.c
      .from('lec_state')
      .select('lec_key, done, updated_at, deleted')
      .eq('user_id', this.uid);
    if (error) throw error;
    return (data ?? []) as RemoteLecture[];
  }

  async fetchSessions(): Promise<RemoteSession[]> {
    const { data, error } = await this.c
      .from('sessions')
      .select('id, subject, block, day, start_ms, seconds, mode, timer_mode, updated_at, deleted')
      .eq('user_id', this.uid);
    if (error) throw error;
    return (data ?? []) as RemoteSession[];
  }

  // Only the columns sent are updated, so the desktop's R1, R2, DPP and note fields are left alone.
  async upsertLectures(rows: LectureUpsert[]): Promise<void> {
    const body = rows.map((r) => ({ ...r, user_id: this.uid, deleted: false }));
    const { error } = await this.c.from('lec_state').upsert(body, { onConflict: 'user_id,lec_key' });
    if (error) throw error;
  }

  async upsertSessions(rows: SessionUpsert[]): Promise<void> {
    const body = rows.map((r) => ({ ...r, user_id: this.uid, deleted: false }));
    const { error } = await this.c.from('sessions').upsert(body, { onConflict: 'user_id,id' });
    if (error) throw error;
  }
}
