/**
 * Calculates the operational business date independently of the host machine timezone.
 * Defaults preserve the original UAE deployment behavior (Asia/Dubai, 06:00).
 */
export interface BusinessDateOptions {
  timeZone?: string;
  dayStart?: string;
}

export function getBusinessDate(now: Date = new Date(), options: BusinessDateOptions = {}): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('A valid date is required to calculate the business date.');
  }
  const timeZone = options.timeZone ?? 'Asia/Dubai';
  const dayStart = options.dayStart ?? '06:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dayStart)) {
    throw new RangeError('Business day start must use HH:mm (00:00–23:59).');
  }
  const [startHour, startMinute] = dayStart.split(':').map(Number);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    throw new RangeError('A valid IANA timezone is required.');
  }
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const beforeBoundary = hour < startHour || (hour === startHour && minute < startMinute);
  const businessDate = new Date(Date.UTC(year, month - 1, day - (beforeBoundary ? 1 : 0)));
  return [
    businessDate.getUTCFullYear(),
    String(businessDate.getUTCMonth() + 1).padStart(2, '0'),
    String(businessDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
