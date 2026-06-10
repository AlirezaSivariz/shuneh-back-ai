/**
 * Availability slot generation.
 *
 * Given a stylist's working intervals for a day, the total service duration and
 * the already-booked intervals, produce the concrete bookable start times.
 * All times are Iran wall-clock "HH:mm" values.
 */
import { Interval, toMinutes, overlaps } from './time';
import { IRAN_OFFSET_MINUTES } from './timezone';

export interface WorkingInterval extends Interval {
  salonId: string | null;
  salon: { id: string; name: string } | null;
}

export interface Slot {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  salonId: string | null;
  salon: { id: string; name: string } | null;
}

function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Iran calendar day (YYYY-MM-DD) and minute-of-day for "now". */
export function iranNow(now: Date = new Date()): { date: string; minutes: number } {
  const shifted = new Date(now.getTime() + IRAN_OFFSET_MINUTES * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minutes };
}

/**
 * Build the list of bookable slots.
 *
 * @param working      The stylist's working intervals for the target day.
 * @param totalDuration Combined duration of the chosen services, in minutes.
 * @param busy         Already-booked intervals (pending/confirmed) for the day.
 * @param step         Granularity of candidate start times, in minutes.
 * @param minStart     Earliest allowed start minute-of-day (for "today").
 */
export function buildSlots(
  working: WorkingInterval[],
  totalDuration: number,
  busy: Interval[],
  step = 15,
  minStart = 0,
): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<string>();

  for (const wi of working) {
    const open = toMinutes(wi.start);
    const close = toMinutes(wi.end);

    for (let start = open; start + totalDuration <= close; start += step) {
      if (start < minStart) continue;

      const candidate: Interval = {
        start: toHHmm(start),
        end: toHHmm(start + totalDuration),
      };

      const clashes = busy.some((b) => overlaps(b, candidate));
      if (clashes) continue;

      const key = `${candidate.start}-${wi.salonId ?? 'freelance'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      slots.push({
        startTime: candidate.start,
        endTime: candidate.end,
        salonId: wi.salonId,
        salon: wi.salon,
      });
    }
  }

  slots.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  return slots;
}
