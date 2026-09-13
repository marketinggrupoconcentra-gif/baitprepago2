import { toZonedTime } from 'date-fns-tz';
import { startOfDay, addDays } from 'date-fns';

const BUSINESS_TIMEZONE = 'America/Mexico_City';

/**
 * Parses a YYYY-MM-DD string into a CDMX business date range.
 * Returns { start, endExclusive } where endExclusive is exactly the start of the next day.
 */
export function getBusinessDayBounds(dateString: string) {
  // Parse assuming the date is in CDMX timezone.
  // Using date-fns-tz we can just parse the local string as if it's CDMX.
  const zoned = toZonedTime(new Date(`${dateString}T00:00:00`), BUSINESS_TIMEZONE);
  const start = startOfDay(zoned);
  const endExclusive = addDays(start, 1);
  return { start, endExclusive };
}
