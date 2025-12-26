/**
 * UK Absence Calculator Types
 *
 * Types for tracking UK Skilled Worker visa absences.
 * Used to calculate rolling 12-month absence windows for ILR eligibility.
 */

/**
 * Represents a trip outside the UK.
 * - departure: The date you left the UK
 * - arrival: The date you returned to the UK (null if currently abroad)
 */
export interface Trip {
  departure: Date;
  arrival: Date | null;
}

/**
 * Parsed line from the trips file.
 * Used as an intermediate representation before constructing Trip objects.
 */
export interface ParsedLine {
  type: "dep" | "arr";
  date: Date;
}

/**
 * Result of parsing a trips file.
 */
export interface ParseResult {
  trips: Trip[];
  /** If true, the last trip has no arrival date (currently abroad) */
  hasOpenTrip: boolean;
}

/**
 * Capacity calculation result for a specific date.
 */
export interface CapacityResult {
  /** The date this calculation is for */
  checkDate: Date;
  /** Total absence days in the 365-day window ending on checkDate */
  usedDays: number;
  /** Remaining days available (180 - usedDays) */
  availableDays: number;
  /** The 180-day limit */
  limit: number;
}

/**
 * Forecast entry showing capacity over time.
 */
export interface ForecastEntry {
  date: Date;
  usedDays: number;
  availableDays: number;
}

/**
 * Result of simulating a continuous trip.
 */
export interface SimulationResult {
  /** Date when 180-day limit would be hit (null if won't hit within simulation period) */
  hitLimitDate: Date | null;
  /** Maximum days that can be spent abroad from the start date */
  maxDays: number;
}

/**
 * The rolling window period in days.
 * Per GOV.UK: absences are counted in any 12-month (365-day) period.
 */
export const WINDOW_DAYS = 365;

/**
 * Maximum allowed absence days in any rolling window.
 * Per GOV.UK: must not exceed 180 days in any 12-month period.
 */
export const ABSENCE_LIMIT = 180;
