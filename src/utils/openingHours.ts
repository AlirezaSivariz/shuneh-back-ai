import { AppError } from './AppError';
import { isOrdered, isValidHHmm } from './time';

export interface OpeningHoursInput {
  dayOfWeek: number;
  intervals: { start: string; end: string }[];
}

/**
 * Validate a salon's opening hours: valid dayOfWeek, HH:mm format and start<end
 * for every interval. Throws AppError with a clear (Persian) message otherwise.
 */
export function assertValidOpeningHours(openingHours: OpeningHoursInput[]): OpeningHoursInput[] {
  for (const day of openingHours) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw AppError.badRequest('روز هفته باید عددی بین ۰ تا ۶ باشد', 'INVALID_DAY_OF_WEEK');
    }
    for (const interval of day.intervals) {
      if (!isValidHHmm(interval.start) || !isValidHHmm(interval.end)) {
        throw AppError.badRequest('فرمت ساعت باید HH:mm باشد', 'INVALID_TIME_FORMAT');
      }
      if (!isOrdered(interval)) {
        throw AppError.badRequest(
          `بازه‌ی ${interval.start}-${interval.end} نامعتبر است (ساعت شروع باید قبل از پایان باشد)`,
          'INVALID_OPENING_HOURS',
        );
      }
    }
  }
  return openingHours;
}
