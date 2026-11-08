/**
 * Returns the queue business date in the Abu Dhabi timezone.
 *
 * The business day rolls over at 06:00 local time. Shifting the instant
 * backwards by six hours before extracting the calendar date preserves
 * that boundary independently of the machine's configured timezone.
 */
const BUSINESS_TIME_ZONE = 'Asia/Dubai';
const BUSINESS_DAY_START_HOUR = 6;
const HOUR_IN_MS = 60 * 60 * 1000;

export function getAbuDhabiBusinessDate(now: Date = new Date()): string {
  const businessInstant = new Date(now.getTime() - BUSINESS_DAY_START_HOUR * HOUR_IN_MS);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(businessInstant);

  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}
