export interface Job {
    key: string;
    name: string;
    hours: number;
    marks?: number;
    block?: string;
}
export interface Lecture {
    id: string;
    h: number;
}
export interface SimOptions {
    lanes: number;
    daily: number;
    shares: ReadonlyArray<number>;
    sunOff: boolean;
    leftover: boolean;
    start: string;
}
export interface Allocation {
    name: string;
    hours: number;
    share: number;
}
export interface SimDay {
    date: string;
    off: boolean;
    alloc: Allocation[];
}
export interface SimResult {
    days: SimDay[];
    finish: string | null;
    done: boolean;
}
/**
 * Fills study lanes day by day. Each lane works one subject at a time, and the day's hours are split
 * between active lanes by their shares. Off-days (Sundays when sunOff) are listed but get no work.
 */
export declare function simulate(jobs: ReadonlyArray<Job>, o: SimOptions): SimResult;
/**
 * Hands each day its lectures in order, per subject. A lecture is never split. A day may run a little
 * over or under; the difference carries to the next day for that subject. Queues are consumed in place.
 */
export declare function fill(simDays: ReadonlyArray<{
    date: string;
    alloc: ReadonlyArray<{
        name: string;
        hours: number;
    }>;
}>, queues: Record<string, Lecture[]>): Record<string, string[]>;
export interface Split {
    days: Record<string, string[]>;
    kept: Set<string>;
}
/**
 * What stays where it is before a re-plan.
 * - today: every lecture stays, done or not (today never moves)
 * - days before today: only ticked lectures stay; unticked ones go back into the queue (catch-up)
 * - days after today: only ticked lectures stay; the rest is re-planned
 */
export declare function keepSplit(oldDays: Record<string, string[]>, today: string, isDone: (id: string) => boolean, isValid: (id: string) => boolean): Split;
export interface ReflowInput {
    start: string;
    opts: Omit<SimOptions, 'start'>;
    js: ReadonlyArray<Job>;
    queues: Record<string, Lecture[]>;
}
/**
 * Rebuilds the days after today. Nothing is dropped: whatever cannot be placed is counted in `unplaced`.
 */
export declare function reflow(split: Split, o: ReflowInput): {
    days: Record<string, string[]>;
    unplaced: number;
};
/**
 * When the work still to do ends: the last day with an unticked lecture.
 * If everything is ticked, the last day with any lecture.
 */
export declare function finish(days: Record<string, string[]>, isValid: (id: string) => boolean, isDone?: (id: string) => boolean): string | null;
