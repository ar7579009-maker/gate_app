// Calendar-day helpers. Days are 'YYYY-MM-DD' strings in local time. Dates are built at noon
// so daylight-saving changes never move a day.
const DAY_MS = 864e5;
const pad = (n) => String(n).padStart(2, '0');
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseDay(day) {
    const [y = NaN, m = NaN, d = NaN] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
}
export function toDay(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Local calendar day (YYYY-MM-DD) of an epoch-millisecond timestamp. */
export function dayOf(ms) {
    return toDay(new Date(ms));
}
export function addDays(day, n) {
    const d = parseDay(day);
    d.setDate(d.getDate() + n);
    return toDay(d);
}
/** Whole days from a to b (b - a). */
export function dayDiff(a, b) {
    return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}
export function isSunday(day) {
    return parseDay(day).getDay() === 0;
}
/** Minutes after midnight for 'HH:MM', or null if the text is not a valid time. */
export function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
    if (!m)
        return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return h > 23 || mi > 59 ? null : h * 60 + mi;
}
