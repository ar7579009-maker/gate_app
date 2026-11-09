// Shared rules: backup checks, timer modes, session days, deleted-session pruning and cleaning of restored state.
import { DAY_RE, dayOf } from './dates.js';
export const TIMER_MODES = ['Learn', 'Practice', 'Revise'];
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** A timer mode the app knows; anything else becomes 'Learn'. */
export function timerMode(m) {
    return TIMER_MODES.includes(m) ? m : 'Learn';
}
/**
 * A session read from the cloud. Rows from before the timer_mode column existed become 'Learn'.
 * `blockOf` looks up the block for a subject when the row has none.
 */
export function sessionFromRow(r, blockOf) {
    return {
        id: r.id,
        subject: r.subject,
        block: r.block || blockOf(r.subject),
        day: r.day,
        seconds: Math.max(0, Math.round(Number(r.seconds) || 0)),
        mode: timerMode(r.timer_mode),
        kind: r.mode === 'up' ? 'stopwatch' : 'countdown',
        start: Number(r.start_ms) || 0,
    };
}
/**
 * A session belongs to the day its timer started. Rewrites `day` where it differs.
 * Returns the ids that changed.
 */
export function repairSessionDays(sessions) {
    const changed = [];
    for (const s of sessions) {
        if (!isNum(s.start) || s.start <= 0)
            continue;
        const d = dayOf(s.start);
        if (s.day !== d) {
            s.day = d;
            changed.push(s.id);
        }
    }
    return changed;
}
/**
 * Deleted-session records are kept for `maxAgeMs`, so an old copy on another device cannot bring them back.
 * Records without a time get `nowMs`, so they are kept for one more period.
 */
export function pruneTombs(tomb, nowMs, maxAgeMs) {
    const out = {};
    for (const [id, s] of Object.entries(tomb)) {
        if (!isObj(s))
            continue;
        const at = isNum(s._at) ? s._at : nowMs;
        if (nowMs - at <= maxAgeMs)
            out[id] = { ...s, _at: at };
    }
    return out;
}
/** The same rules for a backup picked in the app and a backup read by the desktop side. */
export function validateBackup(text, opts = {}) {
    const app = opts.app ?? 'gate-command-center';
    const maxBytes = opts.maxBytes ?? MAX_BACKUP_BYTES;
    if (typeof text !== 'string' || text === '')
        return { ok: false, error: 'The backup is empty.' };
    if (new TextEncoder().encode(text).length > maxBytes)
        return { ok: false, error: 'The backup is too large.' };
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        return { ok: false, error: 'This is not a JSON file.' };
    }
    if (!isObj(data) || data.app !== app) {
        return { ok: false, error: 'This is not a GATE Command Center backup.' };
    }
    const s = data.state;
    if (!isObj(s))
        return { ok: false, error: 'The backup has no saved state.' };
    if ('sessions' in s && !Array.isArray(s.sessions)) {
        return { ok: false, error: 'The sessions in this backup are damaged.' };
    }
    if ('lec' in s && !isObj(s.lec)) {
        return { ok: false, error: 'The lecture progress in this backup is damaged.' };
    }
    return { ok: true, savedAt: String(data.savedAt ?? ''), version: String(data.version ?? '') };
}
const ORDER_IDS = ['pinned', 'mph', 'marks', 'short', 'due', 'block'];
/**
 * Drops or resets restored fields with the wrong shape, so a damaged backup cannot break the screens.
 * Returns the cleaned state and the names of the fields that were skipped.
 */
export function sanitizeState(s) {
    const out = { ...s };
    const dropped = [];
    const keep = (key, ok, fallback) => {
        if (!(key in out) || ok(out[key]))
            return;
        dropped.push(key);
        if (fallback === undefined)
            delete out[key];
        else
            out[key] = fallback;
    };
    keep('sessions', (v) => Array.isArray(v));
    const rows = out.sessions;
    if (Array.isArray(rows)) {
        const before = rows.length;
        const kept = rows.filter((x) => isObj(x) &&
            typeof x.id === 'string' &&
            typeof x.day === 'string' &&
            DAY_RE.test(x.day) &&
            isNum(Number(x.seconds)) &&
            Number(x.seconds) >= 0);
        out.sessions = kept;
        const removed = before - kept.length;
        if (removed > 0)
            dropped.push(`${removed} session row(s)`);
    }
    keep('lec', isObj, {});
    keep('pyq', isObj, {});
    keep('w', (v) => isObj(v) && Object.values(v).every(isNum));
    keep('marks', (v) => isObj(v) && Object.values(v).every(isNum));
    keep('order', (v) => Array.isArray(v) &&
        v.every((o) => isObj(o) && ORDER_IDS.includes(o.id) && typeof o.on === 'boolean'));
    keep('dayPlans', (v) => isObj(v) &&
        Object.values(v).every((p) => isObj(p) &&
            isObj(p.days) &&
            Object.entries(p.days).every(([d, ids]) => DAY_RE.test(d) && Array.isArray(ids) && ids.every((x) => typeof x === 'string'))));
    keep('skipSubj', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
    keep('lecAt', (v) => isObj(v) && Object.values(v).every((x) => typeof x === 'string'));
    keep('shares', (v) => typeof v === 'string');
    return { state: out, dropped };
}
