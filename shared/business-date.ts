/**
 * Returns the queue's business date in Abu Dhabi time.
 *
 * The operational day starts at 06:00 (Asia/Dubai), not at midnight.
 * Extract the local calendar date and hour first, then move back one
 * calendar day when the local time is before the business-day boundary.
 */
const BUSINESS_TIME_ZONE = 'Asia/Dubai';
const BUSINESS_DAY_START_HOUR = 6;

export function getBusinessDate(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('A valid date is required to calculate the business date.');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const hour = Number(value('hour'));

  const businessDate = new Date(Date.UTC(year, month - 1, day - (hour < BUSINESS_DAY_START_HOUR ? 1 : 0)));
  return [
    businessDate.getUTCFullYear(),
    String(businessDate.getUTCMonth() + 1).padStart(2, '0'),
    String(businessDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
