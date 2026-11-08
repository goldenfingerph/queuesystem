/**
 * Returns the queue's business date in Abu Dhabi time.
 *
 * The operational day starts at 06:00 (Asia/Dubai), not at midnight.
 * Subtracting six hours before extracting the local calendar date keeps
 * this rule independent of the machine's configured timezone.
 */
const BUSINESS_TIME_ZONE = 'Asia/Dubai';
const BUSINESS_DAY_START_HOUR = 6;

export function getBusinessDate(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('A valid date is required to calculate the business date.');
  }

  const businessDayInstant = new Date(now.getTime() - BUSINESS_DAY_START_HOUR * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(businessDayInstant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}
