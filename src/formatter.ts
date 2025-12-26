/**
 * Output formatting for the UK absence calculator CLI.
 *
 * Provides human-readable output for capacity calculations and forecasts.
 */

import type {
  CapacityResult,
  ForecastEntry,
  SimulationResult,
  Trip,
} from "./types";
import { ABSENCE_LIMIT } from "./types";

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a date in a more readable format (e.g., "Jan 15, 2025").
 */
export function formatDateReadable(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

/**
 * Format a capacity result for display.
 */
export function formatCapacity(result: CapacityResult): string {
  const lines: string[] = [];

  lines.push(`Date: ${formatDateReadable(result.checkDate)}`);
  lines.push(`Used: ${result.usedDays} / ${result.limit} days`);
  lines.push(`Available: ${result.availableDays} days`);

  // Add warning if approaching limit
  if (result.availableDays <= 0) {
    lines.push("\n⚠️  AT LIMIT - Cannot travel without exceeding 180 days!");
  } else if (result.availableDays <= 10) {
    lines.push(`\n⚠️  WARNING: Only ${result.availableDays} days remaining!`);
  } else if (result.availableDays <= 30) {
    lines.push(`\n⚡ Caution: ${result.availableDays} days remaining`);
  }

  return lines.join("\n");
}

/**
 * Format a simulation result for display.
 */
export function formatSimulation(
  result: SimulationResult,
  startDate: Date
): string {
  const lines: string[] = [];

  if (result.hitLimitDate) {
    lines.push(`If you stay abroad continuously from ${formatDateReadable(startDate)}:`);
    lines.push(`  → You can stay ${result.maxDays} days`);
    lines.push(`  → Would hit 180-day limit on ${formatDateReadable(result.hitLimitDate)}`);
  } else {
    lines.push(`You can stay abroad ${result.maxDays}+ days without hitting the limit.`);
  }

  return lines.join("\n");
}

/**
 * Format a forecast for display.
 * Groups consecutive days with the same capacity to reduce output.
 */
export function formatForecast(
  forecast: ForecastEntry[],
  showAll: boolean = false
): string {
  if (forecast.length === 0) {
    return "No forecast data.";
  }

  const lines: string[] = [];
  lines.push("Capacity Forecast:");
  lines.push("─".repeat(40));

  if (showAll) {
    // Show every day
    for (const entry of forecast) {
      const bar = createProgressBar(entry.usedDays, ABSENCE_LIMIT, 20);
      lines.push(
        `${formatDate(entry.date)}: ${entry.usedDays.toString().padStart(3)} used, ${entry.availableDays.toString().padStart(3)} avail ${bar}`
      );
    }
  } else {
    // Group consecutive days with same capacity
    let i = 0;
    while (i < forecast.length) {
      const start = forecast[i]!;
      let end = start;
      let j = i + 1;

      // Find consecutive days with same usedDays
      while (j < forecast.length && forecast[j]!.usedDays === start.usedDays) {
        end = forecast[j]!;
        j++;
      }

      const bar = createProgressBar(start.usedDays, ABSENCE_LIMIT, 20);

      if (i === j - 1) {
        // Single day
        lines.push(
          `${formatDate(start.date)}: ${start.usedDays.toString().padStart(3)} used, ${start.availableDays.toString().padStart(3)} avail ${bar}`
        );
      } else {
        // Range of days
        lines.push(
          `${formatDate(start.date)} to ${formatDate(end.date)}: ${start.usedDays.toString().padStart(3)} used, ${start.availableDays.toString().padStart(3)} avail ${bar}`
        );
      }

      i = j;
    }
  }

  return lines.join("\n");
}

/**
 * Create a simple progress bar.
 */
function createProgressBar(
  value: number,
  max: number,
  width: number
): string {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

/**
 * Format trip list for display.
 */
export function formatTrips(trips: Trip[]): string {
  if (trips.length === 0) {
    return "No trips recorded.";
  }

  const lines: string[] = [];
  lines.push("Recorded Trips:");
  lines.push("─".repeat(50));

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i]!;
    const num = (i + 1).toString().padStart(2);
    const dep = formatDate(trip.departure);

    if (trip.arrival) {
      const arr = formatDate(trip.arrival);
      // Calculate days
      const days =
        Math.floor(
          (trip.arrival.getTime() - trip.departure.getTime()) /
            (24 * 60 * 60 * 1000)
        ) - 1;
      lines.push(`${num}. ${dep} → ${arr} (${days} days abroad)`);
    } else {
      lines.push(`${num}. ${dep} → (ongoing)`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the main summary output.
 */
export function formatSummary(
  _checkDate: Date,
  trips: Trip[],
  capacity: CapacityResult,
  simulation: SimulationResult | null,
  hasOpenTrip: boolean
): string {
  const sections: string[] = [];

  // Header
  sections.push("╔═══════════════════════════════════════════════════════════╗");
  sections.push("║              UK ILR Absence Calculator                    ║");
  sections.push("╚═══════════════════════════════════════════════════════════╝");
  sections.push("");

  // Trips summary
  sections.push(formatTrips(trips));
  sections.push("");

  // Current capacity
  sections.push("─".repeat(50));
  sections.push(formatCapacity(capacity));
  sections.push("");

  // Simulation for open trips
  if (hasOpenTrip && simulation) {
    sections.push("─".repeat(50));
    const lastTrip = trips[trips.length - 1];
    if (lastTrip) {
      sections.push(formatSimulation(simulation, lastTrip.departure));
    }
    sections.push("");
  }

  // Footer with rules reminder
  sections.push("─".repeat(50));
  sections.push("Rules: GOV.UK rolling 12-month window (365 days)");
  sections.push("       Only whole days abroad count (excl. travel days)");

  return sections.join("\n");
}
