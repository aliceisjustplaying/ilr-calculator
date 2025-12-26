/**
 * Tests for the UK absence calculator core logic.
 *
 * CRITICAL: These tests verify calculations that affect ILR eligibility.
 * Each test case is carefully designed to catch edge cases and ensure
 * the rolling window calculation is correct.
 */

import { describe, expect, test } from "bun:test";

import {
  countInWindow,
  getAbsenceDates,
  getAbsenceDays,
  getCapacity,
  getCapacityForecast,
  getNextCapacityChange,
  simulateContinuousTrip,
  utcDate,
} from "./calculator";
import type { Trip } from "./types";
import { ABSENCE_LIMIT } from "./types";

describe("getAbsenceDays", () => {
  test("dep 1/1, arr 1/3 → 1 day (only Jan 2)", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const arr = utcDate(2025, 0, 3); // Jan 3
    expect(getAbsenceDays(dep, arr)).toBe(1);
  });

  test("dep 1/1, arr 1/2 → 0 days (no full days)", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const arr = utcDate(2025, 0, 2); // Jan 2
    expect(getAbsenceDays(dep, arr)).toBe(0);
  });

  test("dep 1/1, arr 1/10 → 8 days", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const arr = utcDate(2025, 0, 10); // Jan 10
    // Full days: Jan 2, 3, 4, 5, 6, 7, 8, 9 = 8 days
    expect(getAbsenceDays(dep, arr)).toBe(8);
  });

  test("same day departure and arrival → 0 days", () => {
    const date = utcDate(2025, 0, 1);
    expect(getAbsenceDays(date, date)).toBe(0);
  });

  test("long trip: 30 days abroad", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const arr = utcDate(2025, 1, 1); // Feb 1
    // Jan has 31 days, so Jan 1 to Feb 1 is 31 days
    // Absence days: Jan 2-31 = 30 days
    expect(getAbsenceDays(dep, arr)).toBe(30);
  });

  test("trip spanning month boundary", () => {
    const dep = utcDate(2025, 0, 30); // Jan 30
    const arr = utcDate(2025, 1, 3); // Feb 3
    // Full days: Jan 31, Feb 1, Feb 2 = 3 days
    expect(getAbsenceDays(dep, arr)).toBe(3);
  });

  test("trip spanning year boundary", () => {
    const dep = utcDate(2024, 11, 24); // Dec 24, 2024
    const arr = utcDate(2025, 0, 21); // Jan 21, 2025
    // Dec 24 to Jan 21:
    // Dec: 25, 26, 27, 28, 29, 30, 31 = 7 days
    // Jan: 1-20 = 20 days
    // Total: 27 days
    expect(getAbsenceDays(dep, arr)).toBe(27);
  });

  test("open trip uses asOfDate", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const asOf = utcDate(2025, 0, 10); // Jan 10
    // Same as dep 1/1, arr 1/10 → 8 days
    expect(getAbsenceDays(dep, null, asOf)).toBe(8);
  });

  test("leap year February", () => {
    const dep = utcDate(2024, 1, 27); // Feb 27, 2024 (leap year)
    const arr = utcDate(2024, 2, 2); // Mar 2, 2024
    // Full days: Feb 28, Feb 29, Mar 1 = 3 days
    expect(getAbsenceDays(dep, arr)).toBe(3);
  });
});

describe("getAbsenceDates", () => {
  test("returns correct dates for a trip", () => {
    const dep = utcDate(2025, 0, 1); // Jan 1
    const arr = utcDate(2025, 0, 5); // Jan 5
    const dates = getAbsenceDates(dep, arr);

    expect(dates).toHaveLength(3); // Jan 2, 3, 4
    expect(dates[0]!.getUTCDate()).toBe(2);
    expect(dates[1]!.getUTCDate()).toBe(3);
    expect(dates[2]!.getUTCDate()).toBe(4);
  });

  test("returns empty array for same-day trip", () => {
    const date = utcDate(2025, 0, 1);
    expect(getAbsenceDates(date, date)).toHaveLength(0);
  });

  test("returns empty array for next-day return", () => {
    const dep = utcDate(2025, 0, 1);
    const arr = utcDate(2025, 0, 2);
    expect(getAbsenceDates(dep, arr)).toHaveLength(0);
  });
});

describe("countInWindow", () => {
  test("trip fully within window counts all days", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 10) },
    ];
    // Check on Jan 15 - trip is fully in window
    const count = countInWindow(utcDate(2025, 0, 15), trips);
    expect(count).toBe(8); // Jan 2-9
  });

  test("trip partially in window counts only in-window days", () => {
    const trips: Trip[] = [
      { departure: utcDate(2024, 0, 1), arrival: utcDate(2024, 0, 20) },
    ];
    // Check on Jan 10, 2025
    // 365 days before Jan 10, 2025 = Jan 11, 2024 (2024 is leap year)
    // Window is (Jan 11, 2024, Jan 10, 2025]
    // Trip absence days: Jan 2-19 (18 days)
    // Days in window: Jan 12-19 = 8 days (Jan 11 is exclusive boundary)
    const count = countInWindow(utcDate(2025, 0, 10), trips);
    expect(count).toBe(8);
  });

  test("trip fully outside window counts 0 days", () => {
    const trips: Trip[] = [
      { departure: utcDate(2023, 0, 1), arrival: utcDate(2023, 0, 10) },
    ];
    // Check on Jan 1, 2025 - window is Jan 1, 2024 to Jan 1, 2025
    // Trip is in 2023, completely outside
    const count = countInWindow(utcDate(2025, 0, 1), trips);
    expect(count).toBe(0);
  });

  test("multiple trips sum correctly", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 5) }, // 3 days
      { departure: utcDate(2025, 0, 10), arrival: utcDate(2025, 0, 15) }, // 4 days
    ];
    const count = countInWindow(utcDate(2025, 0, 20), trips);
    expect(count).toBe(7); // 3 + 4
  });

  test("empty trips array returns 0", () => {
    const count = countInWindow(utcDate(2025, 0, 1), []);
    expect(count).toBe(0);
  });

  test("window boundary is exclusive start, inclusive end", () => {
    // 365 days before Jan 10, 2025 = Jan 11, 2024 (2024 is leap year)
    const checkDate = utcDate(2025, 0, 10);
    // Window is (Jan 11, 2024, Jan 10, 2025]

    // Trip with absence on Jan 11, 2024 (exactly at window start boundary)
    const tripOnBoundary: Trip[] = [
      { departure: utcDate(2024, 0, 10), arrival: utcDate(2024, 0, 12) },
    ];
    // Absence day is Jan 11, 2024 - exactly at exclusive boundary, should NOT count
    const count1 = countInWindow(checkDate, tripOnBoundary);
    expect(count1).toBe(0);

    // Trip with absence on Jan 12, 2024 (just inside window)
    const tripInsideWindow: Trip[] = [
      { departure: utcDate(2024, 0, 11), arrival: utcDate(2024, 0, 13) },
    ];
    // Absence day is Jan 12, 2024 - inside window, should count
    const count2 = countInWindow(checkDate, tripInsideWindow);
    expect(count2).toBe(1);
  });

  test("open trip counts up to check date", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: null }, // Open trip
    ];
    // Check on Jan 10 - should count Jan 2-9 = 8 days
    const count = countInWindow(utcDate(2025, 0, 10), trips);
    expect(count).toBe(8);
  });

  test("real-world scenario: user's trip data", () => {
    // Reproduce the user's actual calculation from earlier conversation
    const trips: Trip[] = [
      { departure: utcDate(2024, 11, 24), arrival: utcDate(2025, 0, 21) }, // 27 days
      { departure: utcDate(2025, 1, 4), arrival: utcDate(2025, 1, 12) }, // 7 days
      { departure: utcDate(2025, 3, 21), arrival: utcDate(2025, 3, 23) }, // 1 day
      { departure: utcDate(2025, 6, 27), arrival: utcDate(2025, 7, 16) }, // 19 days
      { departure: utcDate(2025, 7, 28), arrival: utcDate(2025, 8, 25) }, // 27 days
      { departure: utcDate(2025, 9, 1), arrival: utcDate(2025, 9, 20) }, // 18 days
      { departure: utcDate(2025, 9, 29), arrival: utcDate(2025, 9, 31) }, // 1 day
      { departure: utcDate(2025, 10, 26), arrival: utcDate(2025, 11, 20) }, // 23 days
    ];

    // Check on Dec 20, 2025
    const count = countInWindow(utcDate(2025, 11, 20), trips);
    // Expected: 27 + 7 + 1 + 19 + 27 + 18 + 1 + 23 = 123 days
    expect(count).toBe(123);
  });
});

describe("getCapacity", () => {
  test("returns correct capacity result", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 1, 20) }, // 49 days (Jan 2 - Feb 19)
    ];
    const result = getCapacity(utcDate(2025, 1, 20), trips);

    expect(result.usedDays).toBe(49);
    expect(result.availableDays).toBe(ABSENCE_LIMIT - 49); // 131
    expect(result.limit).toBe(ABSENCE_LIMIT);
  });

  test("availableDays never goes negative", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 6, 1) }, // ~180 days
    ];
    const result = getCapacity(utcDate(2025, 6, 1), trips);

    expect(result.availableDays).toBeGreaterThanOrEqual(0);
  });
});

describe("simulateContinuousTrip", () => {
  test("calculates max days correctly with no prior trips", () => {
    const result = simulateContinuousTrip(utcDate(2025, 0, 1), []);
    // With no prior trips, can stay 180 days (would hit 180 on day 181)
    // Because absence days exclude dep day, on day 181 we'd have 180 absence days
    expect(result.maxDays).toBe(180);
    expect(result.hitLimitDate).not.toBeNull();
  });

  test("accounts for existing trips", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 51) }, // 49 days
    ];
    // Start new trip on Feb 1
    const result = simulateContinuousTrip(utcDate(2025, 1, 1), trips);
    // Already used 49 days, can use 131 more
    expect(result.maxDays).toBe(131);
  });

  test("accounts for trips falling off window", () => {
    // Trip from a year ago that will fall off during simulation
    const trips: Trip[] = [
      { departure: utcDate(2024, 0, 1), arrival: utcDate(2024, 0, 28) }, // 26 days
    ];
    // Start trip on Jan 1, 2025
    // These 26 days will fall off by end of Jan 2025
    const result = simulateContinuousTrip(utcDate(2025, 0, 1), trips);

    // Should be able to stay longer than 180 - 26 = 154 because old days fall off
    expect(result.maxDays).toBeGreaterThan(154);
  });

  test("ignores open trips (simulates from departure)", () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 10) }, // 8 days
      { departure: utcDate(2025, 0, 15), arrival: null }, // Open trip
    ];
    // Simulate from Jan 15 (the open trip departure)
    const result = simulateContinuousTrip(utcDate(2025, 0, 15), trips);
    // Only the completed 8-day trip counts, so can stay 172 more days
    expect(result.maxDays).toBe(172);
  });

  test("returns null hitLimitDate if limit not reached", () => {
    const result = simulateContinuousTrip(utcDate(2025, 0, 1), [], 30);
    expect(result.hitLimitDate).toBeNull();
    expect(result.maxDays).toBe(30);
  });
});

describe("getCapacityForecast", () => {
  test("returns correct number of entries", () => {
    const forecast = getCapacityForecast(utcDate(2025, 0, 1), [], 30);
    expect(forecast).toHaveLength(30);
  });

  test("shows capacity increasing as trips fall off", () => {
    // Trip that will fall off during January 2025
    // 365 days before Jan 5, 2025 = Jan 6, 2024 (leap year)
    const trips: Trip[] = [
      { departure: utcDate(2024, 0, 5), arrival: utcDate(2024, 0, 15) }, // 9 days (Jan 6-14)
    ];

    // Check forecast from Jan 1, 2025
    const forecast = getCapacityForecast(utcDate(2025, 0, 1), trips, 20);

    // On Jan 5, 2025: window is (Jan 6, 2024, Jan 5, 2025]
    // Trip days Jan 7-14 are in window = 8 days (Jan 6 is at exclusive boundary)
    const jan5 = forecast[4]!;
    expect(jan5.usedDays).toBe(8);

    // On Jan 15, 2025: window is (Jan 16, 2024, Jan 15, 2025]
    // All trip days (Jan 6-14) are before the window start, so 0
    const jan15 = forecast[14]!;
    expect(jan15.usedDays).toBe(0);
  });

  test("forecast dates are consecutive", () => {
    const forecast = getCapacityForecast(utcDate(2025, 0, 1), [], 5);

    for (let i = 1; i < forecast.length; i++) {
      const prevDate = forecast[i - 1]!.date;
      const currDate = forecast[i]!.date;
      const diffDays =
        (currDate.getTime() - prevDate.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(1);
    }
  });
});

describe("getNextCapacityChange", () => {
  test("finds date when a trip day falls off", () => {
    // Trip with absence on Jan 5, 2024
    const trips: Trip[] = [
      { departure: utcDate(2024, 0, 4), arrival: utcDate(2024, 0, 6) }, // 1 day (Jan 5)
    ];

    // From Jan 1, 2025, next change is when Jan 5 falls off
    // 365 days before Jan 4, 2025 = Jan 5, 2024 (leap year)
    // So on Jan 4, 2025: window is (Jan 5, 2024, Jan 4, 2025]
    // Jan 5 is at the exclusive boundary, so it's NOT in the window = 0 days
    // On Jan 3, 2025: window is (Jan 4, 2024, Jan 3, 2025]
    // Jan 5 > Jan 4, so it IS in the window = 1 day
    // So the change happens on Jan 4, 2025
    const nextChange = getNextCapacityChange(utcDate(2025, 0, 1), trips);

    expect(nextChange).not.toBeNull();
    expect(nextChange!.getUTCDate()).toBe(4);
    expect(nextChange!.getUTCMonth()).toBe(0);
  });

  test("returns null if no change within period", () => {
    // No trips = capacity stays constant
    const nextChange = getNextCapacityChange(utcDate(2025, 0, 1), [], 30);
    expect(nextChange).toBeNull();
  });
});

describe("edge cases and regressions", () => {
  test("trip ending on check date counts correctly", () => {
    // Trip that ends on the exact check date
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 10) },
    ];
    // Absence days: Jan 2-9 = 8 days
    // Check on Jan 10 (arrival date) - all 8 days should be in window
    const count = countInWindow(utcDate(2025, 0, 10), trips);
    expect(count).toBe(8);
  });

  test("trip starting on check date counts 0", () => {
    // Trip that starts on the exact check date
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 10), arrival: utcDate(2025, 0, 15) },
    ];
    // On Jan 10, the trip just started - no full days abroad yet
    const count = countInWindow(utcDate(2025, 0, 10), trips);
    expect(count).toBe(0);
  });

  test("very long trip spanning multiple years", () => {
    const trips: Trip[] = [
      { departure: utcDate(2023, 0, 1), arrival: utcDate(2025, 0, 1) }, // 2 years!
    ];
    // Check on Jan 1, 2025
    // Window is (Jan 1, 2024, Jan 1, 2025]
    // All of 2024 is in the window = 366 days (2024 is leap year)
    // But wait, absence days are Jan 2, 2023 to Dec 31, 2024
    // Days in window: Jan 2, 2024 to Dec 31, 2024 = 364 days
    const count = countInWindow(utcDate(2025, 0, 1), trips);
    expect(count).toBe(364);
  });

  test("user scenario: Dec 20, 2025 capacity should be 57", () => {
    // From earlier conversation: 123 days used = 57 remaining
    const trips: Trip[] = [
      { departure: utcDate(2024, 11, 24), arrival: utcDate(2025, 0, 21) },
      { departure: utcDate(2025, 1, 4), arrival: utcDate(2025, 1, 12) },
      { departure: utcDate(2025, 3, 21), arrival: utcDate(2025, 3, 23) },
      { departure: utcDate(2025, 6, 27), arrival: utcDate(2025, 7, 16) },
      { departure: utcDate(2025, 7, 28), arrival: utcDate(2025, 8, 25) },
      { departure: utcDate(2025, 9, 1), arrival: utcDate(2025, 9, 20) },
      { departure: utcDate(2025, 9, 29), arrival: utcDate(2025, 9, 31) },
      { departure: utcDate(2025, 10, 26), arrival: utcDate(2025, 11, 20) },
    ];

    const capacity = getCapacity(utcDate(2025, 11, 20), trips);
    expect(capacity.usedDays).toBe(123);
    expect(capacity.availableDays).toBe(57);
  });

  test("user scenario: Feb 1, 2026 capacity after Dec 20 return", () => {
    // From conversation: if return Dec 20, on Feb 1 should have 84 available
    const trips: Trip[] = [
      { departure: utcDate(2024, 11, 24), arrival: utcDate(2025, 0, 21) },
      { departure: utcDate(2025, 1, 4), arrival: utcDate(2025, 1, 12) },
      { departure: utcDate(2025, 3, 21), arrival: utcDate(2025, 3, 23) },
      { departure: utcDate(2025, 6, 27), arrival: utcDate(2025, 7, 16) },
      { departure: utcDate(2025, 7, 28), arrival: utcDate(2025, 8, 25) },
      { departure: utcDate(2025, 9, 1), arrival: utcDate(2025, 9, 20) },
      { departure: utcDate(2025, 9, 29), arrival: utcDate(2025, 9, 31) },
      { departure: utcDate(2025, 10, 26), arrival: utcDate(2025, 11, 20) },
    ];

    const capacity = getCapacity(utcDate(2026, 1, 1), trips);
    // Trip 1's 27 days have fallen off by Feb 1
    // 123 - 27 = 96 used, 84 available
    expect(capacity.usedDays).toBe(96);
    expect(capacity.availableDays).toBe(84);
  });
});
