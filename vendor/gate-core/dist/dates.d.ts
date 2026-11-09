export declare const DAY_RE: RegExp;
export declare function parseDay(day: string): Date;
export declare function toDay(d: Date): string;
/** Local calendar day (YYYY-MM-DD) of an epoch-millisecond timestamp. */
export declare function dayOf(ms: number): string;
export declare function addDays(day: string, n: number): string;
/** Whole days from a to b (b - a). */
export declare function dayDiff(a: string, b: string): number;
export declare function isSunday(day: string): boolean;
/** Minutes after midnight for 'HH:MM', or null if the text is not a valid time. */
export declare function minutesOf(hhmm: unknown): number | null;
