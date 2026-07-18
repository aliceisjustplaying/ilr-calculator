/**
 * Tests for the UK absence calculator parser.
 *
 * These tests are critical as parsing errors could lead to incorrect
 * absence calculations, potentially affecting ILR eligibility.
 */
import { describe, expect, test } from 'bun:test';

import { ParseError, parseDate, parseLine, parseTrips } from './parser';

describe('parseDate', () => {
  test('parses valid date MM/DD/YY', () => {
    const date = parseDate('12/24/24');
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(11); // December = 11
    expect(date.getUTCDate()).toBe(24);
  });

  test('parses single-digit month and day', () => {
    const date = parseDate('1/5/25');
    expect(date.getUTCFullYear()).toBe(2025);
    expect(date.getUTCMonth()).toBe(0); // January = 0
    expect(date.getUTCDate()).toBe(5);
  });

  test('interprets 2-digit year as 20XX', () => {
    expect(parseDate('1/1/00').getUTCFullYear()).toBe(2000);
    expect(parseDate('1/1/24').getUTCFullYear()).toBe(2024);
    expect(parseDate('1/1/50').getUTCFullYear()).toBe(2050);
    expect(parseDate('1/1/99').getUTCFullYear()).toBe(2099);
  });

  test('rejects invalid date format', () => {
    expect(() => parseDate('2024-12-24')).toThrow('Invalid date format');
    expect(() => parseDate('12/24')).toThrow('Invalid date format');
    expect(() => parseDate('12/24/24/00')).toThrow('Invalid date format');
  });

  test('rejects non-numeric parts', () => {
    expect(() => parseDate('dec/24/24')).toThrow('non-numeric');
    expect(() => parseDate('12/xx/24')).toThrow('non-numeric');
  });

  test('rejects invalid month', () => {
    expect(() => parseDate('0/1/24')).toThrow('Invalid month');
    expect(() => parseDate('13/1/24')).toThrow('Invalid month');
  });

  test('rejects invalid day', () => {
    expect(() => parseDate('1/0/24')).toThrow('Invalid day');
    expect(() => parseDate('1/32/24')).toThrow('Invalid day');
  });

  test('rejects non-existent dates', () => {
    expect(() => parseDate('2/30/24')).toThrow('does not exist');
    expect(() => parseDate('4/31/24')).toThrow('does not exist');
  });

  test('accepts leap year Feb 29', () => {
    const date = parseDate('2/29/24'); // 2024 is a leap year
    expect(date.getUTCMonth()).toBe(1);
    expect(date.getUTCDate()).toBe(29);
  });

  test('rejects Feb 29 on non-leap year', () => {
    expect(() => parseDate('2/29/25')).toThrow('does not exist');
  });
});

describe('parseLine', () => {
  test('parses departure line', () => {
    const result = parseLine('dep 12/24/24');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('dep');
    expect(result!.date.getUTCFullYear()).toBe(2024);
  });

  test('parses arrival line', () => {
    const result = parseLine('arr 1/21/25');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('arr');
    expect(result!.date.getUTCFullYear()).toBe(2025);
  });

  test('is case-insensitive', () => {
    expect(parseLine('DEP 1/1/25')!.type).toBe('dep');
    expect(parseLine('ARR 1/1/25')!.type).toBe('arr');
    expect(parseLine('Dep 1/1/25')!.type).toBe('dep');
  });

  test('handles extra whitespace', () => {
    expect(parseLine('  dep 1/1/25  ')).not.toBeNull();
    expect(parseLine('dep   1/1/25')).not.toBeNull(); // Multiple spaces are allowed
  });

  test('accepts trailing inline comments', () => {
    const result = parseLine('dep 1/1/25   # holiday');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('dep');
    expect(result!.date.getUTCFullYear()).toBe(2025);
  });

  test('returns null for empty lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
  });

  test('returns null for comment lines', () => {
    expect(parseLine('# This is a comment')).toBeNull();
    expect(parseLine('  # Indented comment')).toBeNull();
  });

  test('rejects invalid format', () => {
    expect(() => parseLine('departure 1/1/25')).toThrow('Invalid line format');
    expect(() => parseLine('dep')).toThrow('Invalid line format');
    expect(() => parseLine('1/1/25')).toThrow('Invalid line format');
  });
});

describe('parseTrips', () => {
  test('parses single complete trip', () => {
    const result = parseTrips('dep 12/24/24\narr 1/21/25');
    expect(result.trips).toHaveLength(1);
    expect(result.hasOpenTrip).toBe(false);
    expect(result.trips[0]!.departure.getUTCFullYear()).toBe(2024);
    expect(result.trips[0]!.arrival!.getUTCFullYear()).toBe(2025);
  });

  test('parses multiple trips', () => {
    const content = `
dep 12/24/24
arr 1/21/25
dep 2/4/25
arr 2/12/25
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(2);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('handles open trip (currently abroad)', () => {
    const content = `
dep 12/24/24
arr 1/21/25
dep 2/4/25
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(2);
    expect(result.hasOpenTrip).toBe(true);
    expect(result.trips[1]!.arrival).toBeNull();
  });

  test('handles single open trip', () => {
    const result = parseTrips('dep 12/24/25');
    expect(result.trips).toHaveLength(1);
    expect(result.hasOpenTrip).toBe(true);
    expect(result.trips[0]!.arrival).toBeNull();
  });

  test('ignores empty lines and comments', () => {
    const content = `
# Trip to US
dep 12/24/24
arr 1/21/25

# Trip to Spain
dep 2/4/25
arr 2/12/25
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(2);
  });

  test('returns empty result for empty input', () => {
    const result = parseTrips('');
    expect(result.trips).toHaveLength(0);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('returns empty result for only comments', () => {
    const result = parseTrips('# Just a comment\n# Another one');
    expect(result.trips).toHaveLength(0);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('rejects arrival before departure', () => {
    expect(() => parseTrips('dep 1/21/25\narr 1/20/25')).toThrow('Arrival date must be on or after departure date');
  });

  test('accepts same-day return (day trip, 0 days abroad)', () => {
    const result = parseTrips('dep 1/21/25\narr 1/21/25');
    expect(result.trips).toHaveLength(1);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('rejects starting with arrival', () => {
    expect(() => parseTrips('arr 1/21/25')).toThrow('Expected "dep"');
  });

  test('rejects overlapping trips', () => {
    const content = `
dep 1/1/25
arr 1/10/25
dep 1/5/25
arr 1/15/25
    `.trim();
    expect(() => parseTrips(content)).toThrow('overlap');
  });

  test('accepts same-day turnaround (depart on arrival day)', () => {
    const content = `
dep 1/1/25
arr 1/10/25
dep 1/10/25
arr 1/15/25
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(2);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('accepts adjacent trips (next day)', () => {
    const content = `
dep 1/1/25
arr 1/10/25
dep 1/11/25
arr 1/15/25
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(2);
  });

  test('accepts inline comments in trip files', () => {
    const content = `
dep 1/1/25   # leave UK
arr 1/5/25   # arrive back
    `.trim();
    const result = parseTrips(content);
    expect(result.trips).toHaveLength(1);
    expect(result.hasOpenTrip).toBe(false);
  });

  test('rejects a non-final departure without arrival', () => {
    expect(() => parseTrips('dep 1/1/25\ndep 1/2/25\narr 1/3/25')).toThrow('only valid for the last trip');
  });

  test('rejects two trailing unmatched departures', () => {
    expect(() => parseTrips('dep 1/1/25\narr 1/5/25\ndep 2/1/25\ndep 3/1/25')).toThrow('only valid for the last trip');
  });

  test('throws ParseError with line number', () => {
    try {
      parseTrips('dep 1/1/25\narr invalid\ndep 2/2/25');
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).lineNumber).toBe(2);
    }
  });

  test('preserves actual line numbers after comments', () => {
    try {
      parseTrips('# comment\n\ndep 1/1/25\ndep 1/2/25\narr 1/3/25');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).lineNumber).toBe(3);
    }
  });

  test('parses real-world example', () => {
    // User's actual trip data format
    const content = `
dep 12/24/24
arr 1/21/25
dep 2/4/25
arr 2/12/25
dep 4/21/25
arr 4/23/25
dep 7/27/25
arr 8/16/25
dep 8/28/25
arr 9/25/25
dep 10/1/25
arr 10/20/25
dep 10/29/25
arr 10/31/25
dep 11/26/25
arr 12/9/25
dep 12/24/25
    `.trim();

    const result = parseTrips(content);
    expect(result.trips).toHaveLength(9);
    expect(result.hasOpenTrip).toBe(true);

    // Verify first trip
    expect(result.trips[0]!.departure.getUTCFullYear()).toBe(2024);
    expect(result.trips[0]!.departure.getUTCMonth()).toBe(11); // December
    expect(result.trips[0]!.departure.getUTCDate()).toBe(24);

    // Verify last trip is open
    expect(result.trips[8]!.arrival).toBeNull();
    expect(result.trips[8]!.departure.getUTCMonth()).toBe(11); // December
    expect(result.trips[8]!.departure.getUTCDate()).toBe(24);
  });
});
