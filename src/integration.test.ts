/**
 * Integration tests for the UK ILR Absence Calculator.
 *
 * These tests verify the complete flow from parsing trip files
 * to calculating capacities. They use real-world scenarios
 * derived from the original conversation.
 */
import { describe, expect, test } from 'bun:test';

import { getCapacity, simulateContinuousTrip, utcDate } from './calculator';
import { parseTrips } from './parser';
import type { Trip } from './types';

describe('integration: sample scenarios', () => {
  // Sample trip data based on a realistic travel pattern
  const sampleTripData = `
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
arr 12/20/25
  `.trim();

  test('parses sample trip data correctly', () => {
    const result = parseTrips(sampleTripData);

    expect(result.trips).toHaveLength(8);
    expect(result.hasOpenTrip).toBe(false);

    // Verify first trip
    expect(result.trips[0]!.departure.getUTCFullYear()).toBe(2024);
    expect(result.trips[0]!.departure.getUTCMonth()).toBe(11); // December
    expect(result.trips[0]!.departure.getUTCDate()).toBe(24);
    expect(result.trips[0]!.arrival!.getUTCMonth()).toBe(0); // January
    expect(result.trips[0]!.arrival!.getUTCDate()).toBe(21);
  });

  test('Dec 20, 2025: 123 days used, 57 available', () => {
    // This matches the Python calculation from the conversation
    const result = parseTrips(sampleTripData);
    const capacity = getCapacity(utcDate(2025, 11, 20), result.trips);

    expect(capacity.usedDays).toBe(123);
    expect(capacity.availableDays).toBe(57);
  });

  test('Feb 1, 2026: Trip 1 has fallen off', () => {
    // By Feb 1, 2026, the first trip (27 days) should have fallen off
    const result = parseTrips(sampleTripData);
    const capacity = getCapacity(utcDate(2026, 1, 1), result.trips);

    // 123 - 27 = 96 days used
    expect(capacity.usedDays).toBe(96);
    expect(capacity.availableDays).toBe(84);
  });

  test('open trip scenario: stay until Mar 21', () => {
    // If user stays abroad until Mar 21, they'd hit 180
    const dataWithOpenTrip = sampleTripData + '\ndep 12/24/25';
    const result = parseTrips(dataWithOpenTrip);

    expect(result.hasOpenTrip).toBe(true);
    expect(result.trips).toHaveLength(9);

    // Simulate continuous trip from Dec 24
    const simulation = simulateContinuousTrip(
      utcDate(2025, 11, 24),
      result.trips.slice(0, -1), // Exclude the open trip for simulation
    );

    // Should be able to stay ~90 days before hitting 180
    // (This matches the Python calculation)
    expect(simulation.maxDays).toBeGreaterThanOrEqual(85);
    expect(simulation.maxDays).toBeLessThanOrEqual(95);
  });

  test('return Jan 3, then March trip scenario', () => {
    // Scenario: return Jan 3, then travel all of March
    const trips: Trip[] = [
      { departure: utcDate(2024, 11, 24), arrival: utcDate(2025, 0, 21) },
      { departure: utcDate(2025, 1, 4), arrival: utcDate(2025, 1, 12) },
      { departure: utcDate(2025, 3, 21), arrival: utcDate(2025, 3, 23) },
      { departure: utcDate(2025, 6, 27), arrival: utcDate(2025, 7, 16) },
      { departure: utcDate(2025, 7, 28), arrival: utcDate(2025, 8, 25) },
      { departure: utcDate(2025, 9, 1), arrival: utcDate(2025, 9, 20) },
      { departure: utcDate(2025, 9, 29), arrival: utcDate(2025, 9, 31) },
      { departure: utcDate(2025, 10, 26), arrival: utcDate(2026, 0, 3) }, // Return Jan 3
      { departure: utcDate(2026, 2, 1), arrival: utcDate(2026, 3, 1) }, // All of March
    ];

    // On Apr 1, 2026 (return from March)
    const capacity = getCapacity(utcDate(2026, 3, 1), trips);

    // Should have ~47 days available (from Python calculation)
    expect(capacity.availableDays).toBeGreaterThanOrEqual(40);
    expect(capacity.availableDays).toBeLessThanOrEqual(55);
  });

  test('free travel window: Dec 25 - Jan 20', () => {
    // The "use it or lose it" window where Trip 1 falls off
    const result = parseTrips(sampleTripData);

    // On Dec 24: just before Trip 1 starts falling off
    const dec24 = getCapacity(utcDate(2025, 11, 24), result.trips);

    // On Jan 21: after Trip 1 has fully fallen off
    const jan21 = getCapacity(utcDate(2026, 0, 21), result.trips);

    // Trip 1 was 27 days, so capacity should increase by 27
    expect(jan21.usedDays).toBe(dec24.usedDays - 27);
  });
});

describe('integration: edge cases', () => {
  test('empty trips file', () => {
    const result = parseTrips('');
    expect(result.trips).toHaveLength(0);
    expect(result.hasOpenTrip).toBe(false);

    const capacity = getCapacity(utcDate(2025, 0, 1), result.trips);
    expect(capacity.usedDays).toBe(0);
    expect(capacity.availableDays).toBe(180);
  });

  test('single day trip', () => {
    // Departure on Jan 1, arrival on Jan 2 = 0 full days abroad
    const result = parseTrips('dep 1/1/25\narr 1/2/25');
    expect(result.trips).toHaveLength(1);

    const capacity = getCapacity(utcDate(2025, 0, 5), result.trips);
    expect(capacity.usedDays).toBe(0);
  });

  test('trip spanning year boundary', () => {
    const result = parseTrips('dep 12/30/24\narr 1/3/25');
    expect(result.trips).toHaveLength(1);

    // Full days: Dec 31, Jan 1, Jan 2 = 3 days
    const capacity = getCapacity(utcDate(2025, 0, 10), result.trips);
    expect(capacity.usedDays).toBe(3);
  });

  test('comments and blank lines are ignored', () => {
    const data = `
# First trip to US
dep 1/1/25
arr 1/10/25

# Second trip to Spain
dep 2/1/25
arr 2/10/25
    `.trim();

    const result = parseTrips(data);
    expect(result.trips).toHaveLength(2);
  });

  test('at exactly 180 days', () => {
    // Create a trip of exactly 181 days (to have 180 absence days)
    const result = parseTrips('dep 1/1/25\narr 7/2/25');

    // Check on Jul 2 (arrival day)
    const capacity = getCapacity(utcDate(2025, 6, 2), result.trips);
    expect(capacity.usedDays).toBe(181); // Jan 2 - Jul 1 = 181 days
    expect(capacity.availableDays).toBe(0);
  });
});

describe('integration: simulation accuracy', () => {
  test('simulation matches day-by-day calculation', () => {
    const trips: Trip[] = [
      { departure: utcDate(2025, 0, 1), arrival: utcDate(2025, 0, 50) }, // 48 days
    ];

    const simulation = simulateContinuousTrip(utcDate(2025, 1, 1), trips);

    // With 48 days used, should be able to stay 132 more days
    expect(simulation.maxDays).toBe(132);
  });

  test('simulation accounts for trips falling off', () => {
    // Trip from exactly a year ago
    const trips: Trip[] = [
      { departure: utcDate(2024, 0, 1), arrival: utcDate(2024, 0, 28) }, // 26 days
    ];

    // Start trip on Jan 1, 2025
    const simulation = simulateContinuousTrip(utcDate(2025, 0, 1), trips);

    // Should be able to stay more than 180 - 26 = 154 days
    // because the old trip will fall off during the simulation
    expect(simulation.maxDays).toBeGreaterThan(154);
  });
});
