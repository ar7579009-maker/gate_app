export declare const TIMER_MODES: readonly ['Learn', 'Practice', 'Revise'];
export type TimerMode = (typeof TIMER_MODES)[number];
export declare const MAX_BACKUP_BYTES: number;
/** A timer mode the app knows; anything else becomes 'Learn'. */
export declare function timerMode(m: unknown): TimerMode;
export interface SessionRow {
    id: string;
    subject: string;
    block?: string | undefined;
    day: string;
    seconds: number;
    timer_mode?: unknown;
    mode?: unknown;
    start_ms?: unknown;
}
export interface Session {
    id: string;
    subject: string;
    block: string;
    day: string;
    seconds: number;
    mode: TimerMode;
    kind: 'stopwatch' | 'countdown';
    start: number;
}
/**
 * A session read from the cloud. Rows from before the timer_mode column existed become 'Learn'.
 * `blockOf` looks up the block for a subject when the row has none.
 */
export declare function sessionFromRow(r: SessionRow, blockOf: (subject: string) => string): Session;
/**
 * A session belongs to the day its timer started. Rewrites `day` where it differs.
 * Returns the ids that changed.
 */
export declare function repairSessionDays(sessions: ReadonlyArray<{
    id: string;
    day: string;
    start: number;
}>): string[];
export interface Tomb {
    _at?: number;
    [k: string]: unknown;
}
/**
 * Deleted-session records are kept for `maxAgeMs`, so an old copy on another device cannot bring them back.
 * Records without a time get `nowMs`, so they are kept for one more period.
 */
export declare function pruneTombs(tomb: Record<string, unknown>, nowMs: number, maxAgeMs: number): Record<string, Tomb>;
export type ValidationResult = {
    ok: true;
    savedAt: string;
    version: string;
} | {
    ok: false;
    error: string;
};
export interface ValidateOptions {
    app?: string;
    maxBytes?: number;
}
/** The same rules for a backup picked in the app and a backup read by the desktop side. */
export declare function validateBackup(text: unknown, opts?: ValidateOptions): ValidationResult;
export interface SanitizeResult {
    state: Record<string, unknown>;
    dropped: string[];
}
/**
 * Drops or resets restored fields with the wrong shape, so a damaged backup cannot break the screens.
 * Returns the cleaned state and the names of the fields that were skipped.
 */
export declare function sanitizeState(s: Record<string, unknown>): SanitizeResult;
