export interface Session {
    day: string;
    seconds: number;
}
export type PaceStatus = 'none' | 'ok' | 'close' | 'behind';
export interface RecentPace {
    days: number;
    total: number;
    avg: number | null;
    today: number;
    yesterday: number;
}
/** Hours studied per day, from timer sessions. Bad rows are ignored. */
export declare function hoursByDay(sessions: ReadonlyArray<Partial<Session> | null | undefined>): Record<string, number>;
/**
 * Average hours per day over the `windowDays` days before `today`. Today is not counted (not finished).
 * If tracking began less than a window ago, only the days since then count; empty days inside count as zero.
 */
export declare function recentPace(sessions: ReadonlyArray<Partial<Session> | null | undefined>, today: string, windowDays?: number): RecentPace;
/** Calendar days from `from` to `to`, both included. Sundays are skipped when sunOff is set. */
export declare function workDays(from: string, to: string, sunOff: boolean): number;
/** Hours per day needed to use up `hoursLeft` by the deadline. null when the deadline has passed. */
export declare function neededPerDay(hoursLeft: number, today: string, deadline: string, sunOff: boolean): number | null;
/**
 * The day the hours run out at `perDay` hours a day (today counts as a full day).
 * Returns null if it never does, or if it is beyond `cap` days.
 */
export declare function projectFinish(hoursLeft: number, perDay: number, today: string, sunOff: boolean, cap?: number): string | null;
/** 'ok' at or above the needed pace, 'close' within a quarter of it, otherwise 'behind'. */
export declare function status(avg: number | null, need: number | null): PaceStatus;
export interface NudgeInput {
    now: Date;
    /** window start, 'HH:MM' */
    at: string;
    /** window end, 'HH:MM'; null or undefined means 21:00 */
    until?: string | null;
    /** minutes between reminders */
    every: number;
    /** maximum reminders per day */
    max: number;
    /** reminders already sent today */
    count: number;
    /** epoch ms of the last reminder, 0 if none */
    last: number;
    /** seconds studied today */
    secs: number;
    /** seconds of study that count as "started" */
    minSecs: number;
    running: boolean;
}
/** Should the study reminder fire now? */
export declare function shouldNudge(o: NudgeInput): boolean;
