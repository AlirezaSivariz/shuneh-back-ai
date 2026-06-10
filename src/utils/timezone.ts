/**
 * Iran timezone handling.
 *
 * Iran Standard Time is a fixed UTC+03:30 (Iran abolished daylight-saving in
 * 2022, so there is no DST to account for). We model wall-clock times in Iran
 * and convert them to absolute UTC instants for storage/comparison.
 */
export const IRAN_OFFSET_MINUTES = 3 * 60 + 30; // +03:30 => 210 minutes

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Convert an Iran wall-clock time (the calendar day taken from `date`'s UTC
 * Y/M/D, plus an "HH:mm" time) into the absolute UTC instant it represents.
 *
 * Convention: `date` carries the intended Iran calendar day in its UTC
 * components (e.g. stored as that day's midnight). Because Iran local time is
 * UTC + offset, the true UTC instant of a given local wall-clock is
 * `localAsUtc - offset`.
 */
export function iranWallClockToUtc(date: Date, hhmm: string): Date {
  const match = HHMM.exec(hhmm);
  if (!match) throw new Error(`Invalid time "${hhmm}", expected HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  const localAsUtcMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  );
  return new Date(localAsUtcMs - IRAN_OFFSET_MINUTES * 60_000);
}
