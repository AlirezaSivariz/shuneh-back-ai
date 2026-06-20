/**
 * Helpers for "HH:mm" time-of-day values and interval overlap checks.
 */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHHmm(value: string): boolean {
  return HHMM.test(value);
}

/** Minutes since midnight for an "HH:mm" string. */
export function toMinutes(value: string): number {
  const match = HHMM.exec(value);
  if (!match) throw new Error(`Invalid time "${value}", expected HH:mm`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "HH:mm" for a minute-of-day value. */
export function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface Interval {
  start: string; // HH:mm
  end: string; // HH:mm
}

/** True when start < end (a non-empty, well-ordered interval). */
export function isOrdered(interval: Interval): boolean {
  return toMinutes(interval.start) < toMinutes(interval.end);
}

/** True when two intervals overlap (touching endpoints do NOT count as overlap). */
export function overlaps(a: Interval, b: Interval): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** True when `inner` fits completely inside `outer` (inclusive endpoints). */
export function contains(outer: Interval, inner: Interval): boolean {
  return (
    toMinutes(inner.start) >= toMinutes(outer.start) &&
    toMinutes(inner.end) <= toMinutes(outer.end)
  );
}

/** The overlapping portion of two intervals, or null when they don't overlap. */
export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(toMinutes(a.start), toMinutes(b.start));
  const end = Math.min(toMinutes(a.end), toMinutes(b.end));
  return start < end ? { start: toHHmm(start), end: toHHmm(end) } : null;
}
