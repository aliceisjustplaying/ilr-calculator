/**
 * UK Absence Calculator - Core calculation logic.
 *
 * Implements the rolling 12-month window calculation per GOV.UK rules:
 * - Only WHOLE days outside UK count (departure & arrival days excluded)
 * - Rolling 12-CALENDAR-MONTH window (366 days when it spans 29 Feb)
 * - Limit: no MORE than 180 days in any 12-month period (180 exactly is legal)
 *
 * CRITICAL: These calculations affect ILR eligibility. All logic must be
 * thoroughly tested and verified against known correct values.
 */
import type { CapacityResult, ForecastEntry, SimulationResult, Trip } from './types';
import { ABSENCE_LIMIT } from './types';

/**
 * Normalize a date to midnight UTC on the same UTC calendar day.
 */
export function utcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Compute the EXCLUSIVE start of the rolling 12-month window ending on `date`.
 *
 * The Home Office rule is "180 days in any 12-month period", i.e. calendar
 * months - NOT a fixed 365 days. A window spanning 29 February is 366 days
 * wide; using a fixed 365 makes such windows one day too narrow, which can
 * UNDERCOUNT absences (the unsafe direction).
 *
 * When the same day-of-month does not exist one year earlier (checkDate is
 * 29 Feb), we clamp BACKWARD to 28 Feb so the window is never narrower than
 * 12 calendar months (conservative direction).
 */
export function windowStartFor(date: Date): Date {
  const y = date.getUTCFullYear() - 1;
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const candidate = new Date(Date.UTC(y, m, d));
  if (candidate.getUTCMonth() !== m) {
    // Day rolled into the next month (29 Feb -> 1 Mar): clamp to the last
    // day of the intended month instead.
    return new Date(Date.UTC(y, m + 1, 0));
  }
  return candidate;
}

/**
 * Calculate the number of absence days for a trip.
 *
 * Per GOV.UK guidance, only WHOLE days outside the UK count:
 * - The departure day does NOT count (you were in UK part of that day)
 * - The arrival day does NOT count (you returned to UK that day)
 * - Only full 24-hour periods abroad count
 *
 * @param departure - Date of departure from UK
 * @param arrival - Date of arrival back to UK (null if currently abroad)
 * @param asOfDate - For open trips, calculate days as of this date (default: now)
 * @returns Number of full days outside UK
 *
 * @example
 * // dep 1/1, arr 1/3 → 1 day (only Jan 2 counts)
 * getAbsenceDays(new Date('2025-01-01'), new Date('2025-01-03')) // → 1
 *
 * @example
 * // dep 1/1, arr 1/2 → 0 days (no full days outside)
 * getAbsenceDays(new Date('2025-01-01'), new Date('2025-01-02')) // → 0
 */
export function getAbsenceDays(departure: Date, arrival: Date | null, asOfDate?: Date): number {
  // For open trips, use asOfDate as the effective "current" date
  // The person is still abroad, so we count up to (but not including) asOfDate
  const effectiveEnd = arrival ?? asOfDate ?? new Date();

  // Calculate milliseconds between dates
  const msPerDay = 24 * 60 * 60 * 1000;

  // Use UTC to avoid daylight saving issues
  const depTime = Date.UTC(departure.getUTCFullYear(), departure.getUTCMonth(), departure.getUTCDate());
  const arrTime = Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate());

  // Days between departure and arrival (exclusive of both)
  // If dep=1, arr=3: we want to count only day 2, so (3-1) - 1 = 1
  const totalDays = Math.floor((arrTime - depTime) / msPerDay);
  const absenceDays = totalDays - 1;

  return Math.max(0, absenceDays);
}

/**
 * Get all individual absence dates for a trip.
 *
 * Returns the actual dates that count as absence days (for window calculations).
 *
 * @param departure - Date of departure from UK
 * @param arrival - Date of arrival back to UK (null if currently abroad)
 * @param asOfDate - For open trips, calculate dates as of this date
 * @returns Array of dates that are absence days
 */
export function getAbsenceDates(departure: Date, arrival: Date | null, asOfDate?: Date): Date[] {
  const dates: Date[] = [];
  const effectiveEnd = arrival ?? asOfDate ?? new Date();

  // Start from day after departure
  const current = new Date(Date.UTC(departure.getUTCFullYear(), departure.getUTCMonth(), departure.getUTCDate() + 1));

  const endTime = Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate());

  // Add each day until (but not including) arrival
  while (current.getTime() < endTime) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Count absence days within a rolling window.
 *
 * The window is (checkDate - 12 months, checkDate], meaning:
 * - The start boundary is EXCLUSIVE
 * - The check date is INCLUSIVE
 *
 * @param checkDate - The date to check (window ends on this day)
 * @param trips - Array of trips to count
 * @returns Number of absence days in the 12-month window
 */
export function countInWindow(checkDate: Date, trips: Trip[]): number {
  // Window: (checkDate - 12 calendar months, checkDate]
  const windowStart = windowStartFor(checkDate);

  const windowStartTime = windowStart.getTime();
  const checkDateTime = Date.UTC(checkDate.getUTCFullYear(), checkDate.getUTCMonth(), checkDate.getUTCDate());

  // For open trips, assume the person stays abroad through checkDate.
  // Pessimistic by design: a future-dated forecast while abroad should not
  // silently assume you fly home today. Use --return-date to model a
  // planned return instead.
  const openTripEndDate = checkDate;

  let totalDays = 0;

  for (const trip of trips) {
    // Get all absence dates for this trip
    // For open trips, project through the checkDate being evaluated
    const effectiveAsOf = trip.arrival === null ? openTripEndDate : checkDate;
    const absenceDates = getAbsenceDates(trip.departure, trip.arrival, effectiveAsOf);

    // Count only dates within the window
    for (const date of absenceDates) {
      const dateTime = date.getTime();
      // Window is (windowStart, checkDate] - exclusive start, inclusive end
      if (dateTime > windowStartTime && dateTime <= checkDateTime) {
        totalDays++;
      }
    }
  }

  return totalDays;
}

/**
 * Calculate capacity for a specific date.
 *
 * @param checkDate - The date to calculate capacity for
 * @param trips - Array of trips
 * @returns CapacityResult with used and available days
 */
export function getCapacity(checkDate: Date, trips: Trip[]): CapacityResult {
  const usedDays = countInWindow(checkDate, trips);
  const availableDays = Math.max(0, ABSENCE_LIMIT - usedDays);

  return {
    checkDate,
    usedDays,
    availableDays,
    limit: ABSENCE_LIMIT,
  };
}

/**
 * Simulate staying abroad continuously from a start date.
 *
 * Calculates how many days can be spent abroad before hitting the 180-day limit.
 * Takes into account that old absence days fall off the rolling window over time.
 *
 * @param startDate - The date the continuous trip starts (departure date)
 * @param trips - Existing trips (may include an open trip)
 * @param maxSimulationDays - Maximum days to simulate (default: 365)
 * @returns SimulationResult with hit date and max days
 */
export function simulateContinuousTrip(startDate: Date, trips: Trip[], maxSimulationDays = 365): SimulationResult {
  // Build list of completed trips (exclude any open trip since we're simulating from startDate)
  const completedTrips = trips.filter((t) => t.arrival !== null);

  // Simulate each day
  let day = 1;
  while (day <= maxSimulationDays) {
    // Current simulation date
    const simDate = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + day),
    );

    // Create a hypothetical trip from startDate to simDate
    const hypotheticalTrip: Trip = {
      departure: startDate,
      arrival: simDate,
    };

    // Calculate total absence days including the hypothetical trip
    const allTrips = [...completedTrips, hypotheticalTrip];
    const usedDays = countInWindow(simDate, allTrips);

    if (usedDays > ABSENCE_LIMIT) {
      // The rule is "must not spend MORE than 180 days" abroad, so a window
      // containing exactly 180 absence days is still legal. Only a window
      // that EXCEEDS the limit breaks continuous residence.
      // The day before is the last safe day.
      return {
        hitLimitDate: simDate,
        maxDays: day - 1,
      };
    }

    day++;
  }

  // Didn't hit limit within simulation period
  return {
    hitLimitDate: null,
    maxDays: maxSimulationDays,
  };
}

/**
 * Get capacity forecast over a period.
 *
 * Shows how capacity changes day by day as old trips fall off the window.
 *
 * @param startDate - Start of forecast period
 * @param trips - Array of trips
 * @param days - Number of days to forecast
 * @returns Array of ForecastEntry for each day
 */
export function getCapacityForecast(startDate: Date, trips: Trip[], days: number): ForecastEntry[] {
  const forecast: ForecastEntry[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate() + i));

    const usedDays = countInWindow(date, trips);
    const availableDays = Math.max(0, ABSENCE_LIMIT - usedDays);

    forecast.push({
      date,
      usedDays,
      availableDays,
    });
  }

  return forecast;
}

/**
 * Find the next date when capacity will change (a trip day falls off the window).
 *
 * Useful for understanding when capacity will increase.
 *
 * @param fromDate - Start looking from this date
 * @param trips - Array of trips
 * @param maxDays - Maximum days to look ahead
 * @returns Date when capacity next changes, or null if no change within period
 */
export function getNextCapacityChange(fromDate: Date, trips: Trip[], maxDays = 365): Date | null {
  const currentCapacity = countInWindow(fromDate, trips);

  for (let i = 1; i <= maxDays; i++) {
    const date = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate() + i));

    const newCapacity = countInWindow(date, trips);
    if (newCapacity !== currentCapacity) {
      return date;
    }
  }

  return null;
}

/**
 * Create a Date at midnight UTC from year, month (0-indexed), day.
 * Helper for creating test dates.
 */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}
