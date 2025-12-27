/**
 * Parser for UK absence trip files.
 *
 * Parses files with the format:
 *   dep MM/DD/YY
 *   arr MM/DD/YY
 *   dep MM/DD/YY
 *   arr MM/DD/YY
 *   ...
 *
 * The last line can be a "dep" without a corresponding "arr" if currently abroad.
 */
import type { ParseResult, ParsedLine, Trip } from './types';

/**
 * Error thrown when parsing fails.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public lineNumber: number,
    public line: string,
  ) {
    super(`Line ${lineNumber}: ${message} ("${line}")`);
    this.name = 'ParseError';
  }
}

/**
 * Parse a date string in MM/DD/YY format.
 * Years are interpreted as 20XX (e.g., 24 = 2024, 25 = 2025).
 *
 * @param dateStr - Date string like "12/24/24" or "1/5/25"
 * @returns Parsed Date object (at midnight UTC)
 * @throws Error if the date format is invalid
 */
export function parseDate(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: "${dateStr}" (expected MM/DD/YY)`);
  }

  const [monthStr, dayStr, yearStr] = parts as [string, string, string];
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const yearShort = parseInt(yearStr, 10);

  if (isNaN(month) || isNaN(day) || isNaN(yearShort)) {
    throw new Error(`Invalid date format: "${dateStr}" (non-numeric parts)`);
  }

  // Validate ranges
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month} (must be 1-12)`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`Invalid day: ${day} (must be 1-31)`);
  }
  if (yearShort < 0 || yearShort > 99) {
    throw new Error(`Invalid year: ${yearShort} (must be 0-99)`);
  }

  // Always interpret as 20XX
  const year = 2000 + yearShort;

  // Create date at midnight UTC to avoid timezone issues
  const date = new Date(Date.UTC(year, month - 1, day));

  // Validate the date is real (e.g., Feb 30 would roll over)
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCFullYear() !== year) {
    throw new Error(`Invalid date: ${month}/${day}/${yearShort} does not exist`);
  }

  return date;
}

/**
 * Parse a single line from the trips file.
 *
 * @param line - Line like "dep 12/24/24" or "arr 1/21/25"
 * @returns Parsed line with type and date
 * @throws Error if the line format is invalid
 */
export function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }

  const match = /^(dep|arr)\s+(\S+)$/i.exec(trimmed);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid line format: expected "dep MM/DD/YY" or "arr MM/DD/YY"`);
  }

  const type = match[1].toLowerCase() as 'dep' | 'arr';
  const date = parseDate(match[2]);

  return { type, date };
}

/**
 * Parse a trips file content into Trip objects.
 *
 * @param content - Full file content as a string
 * @returns ParseResult with trips array and hasOpenTrip flag
 * @throws ParseError if the file format is invalid
 */
export function parseTrips(content: string): ParseResult {
  const lines = content.split('\n');
  const parsedLines: ParsedLine[] = [];

  // Parse all lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    try {
      const parsed = parseLine(line);
      if (parsed !== null) {
        parsedLines.push(parsed);
      }
    } catch (error) {
      throw new ParseError(error instanceof Error ? error.message : String(error), i + 1, line);
    }
  }

  // Validate and construct trips
  const trips: Trip[] = [];
  let i = 0;

  while (i < parsedLines.length) {
    const depLine = parsedLines[i];
    if (!depLine) break;

    // Must start with a departure
    if (depLine.type !== 'dep') {
      throw new ParseError(`Expected "dep" but got "arr"`, i + 1, `arr ${formatDateForError(depLine.date)}`);
    }

    // Check if there's a corresponding arrival
    const arrLine = parsedLines[i + 1];
    if (arrLine) {
      if (arrLine.type === 'arr') {
        // Validate arrival is on or after departure (same-day return = 0 days abroad)
        if (arrLine.date < depLine.date) {
          throw new ParseError(
            `Arrival date must be on or after departure date`,
            i + 2,
            `arr ${formatDateForError(arrLine.date)}`,
          );
        }

        trips.push({
          departure: depLine.date,
          arrival: arrLine.date,
        });
        i += 2;
      } else {
        // Next line is another departure - this departure has no arrival yet
        // This is only valid if it's the last departure
        const nextDep = arrLine; // It's a dep, not arr
        if (nextDep.date <= depLine.date) {
          throw new ParseError(
            `Departure dates must be in chronological order`,
            i + 2,
            `dep ${formatDateForError(nextDep.date)}`,
          );
        }
        // Open trip (currently abroad)
        trips.push({
          departure: depLine.date,
          arrival: null,
        });
        i += 1;
      }
    } else {
      // Last entry is a departure with no arrival (open trip)
      trips.push({
        departure: depLine.date,
        arrival: null,
      });
      i += 1;
    }
  }

  // Validate trips are in chronological order
  for (let j = 1; j < trips.length; j++) {
    const prevTrip = trips[j - 1];
    const currTrip = trips[j];
    if (!prevTrip || !currTrip) continue;

    // Previous trip must end before or on the same day current trip starts (same-day turnaround allowed)
    const prevEnd = prevTrip.arrival ?? prevTrip.departure;
    if (currTrip.departure < prevEnd) {
      throw new ParseError(
        `Trips must not overlap: departure on ${formatDateForError(currTrip.departure)} is before previous trip ended`,
        0,
        '',
      );
    }
  }

  const lastTrip = trips[trips.length - 1];
  const hasOpenTrip = trips.length > 0 && lastTrip?.arrival === null;

  return { trips, hasOpenTrip };
}

/**
 * Parse a trips file from the filesystem.
 *
 * @param filePath - Path to the trips file
 * @returns ParseResult with trips array and hasOpenTrip flag
 */
export async function parseTripsFile(filePath: string): Promise<ParseResult> {
  const content = await Bun.file(filePath).text();
  return parseTrips(content);
}

/**
 * Format a date for error messages.
 */
function formatDateForError(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear() % 100;
  return `${month}/${day}/${year.toString().padStart(2, '0')}`;
}
