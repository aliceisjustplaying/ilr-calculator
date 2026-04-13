#!/usr/bin/env bun
/**
 * UK ILR Absence Calculator CLI
 *
 * Tracks absences for UK Skilled Worker visa holders planning for ILR.
 * Calculates the rolling 12-month (365-day) window per GOV.UK rules.
 *
 * Usage:
 *   bun run src/cli.ts trips.txt                    # Check capacity today
 *   bun run src/cli.ts trips.txt --date 2026-02-01  # Check on specific date
 *   bun run src/cli.ts trips.txt --forecast 90      # Show 90-day forecast
 *   bun run src/cli.ts trips.txt --return-date 2025-12-20  # Simulate return date
 */
import { getCapacity, getCapacityForecast, simulateContinuousTrip, utcDate, utcStartOfDay } from './calculator';
import {
  formatCapacity,
  formatDateReadable,
  formatForecast,
  formatHeader,
  formatSimulation,
  formatSummary,
} from './formatter';
import { parseTripsFile } from './parser';

/**
 * Parse command line arguments.
 */
function parseArgs(): {
  tripsFile: string;
  checkDate: Date;
  hasExplicitDate: boolean;
  forecastDays: number | null;
  returnDate: Date | null;
  showTrips: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);

  let tripsFile = '';
  // Default to today's UTC calendar date to keep calculations timezone-stable.
  const now = new Date();
  let checkDate = utcStartOfDay(now);
  let hasExplicitDate = false;
  let forecastDays: number | null = null;
  let returnDate: Date | null = null;
  let showTrips = false;
  let help = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      i++;
    } else if (arg === '--date' || arg === '-d') {
      const dateStr = args[i + 1];
      if (dateStr === undefined || dateStr === '') {
        console.error('Error: --date requires a date argument (YYYY-MM-DD)');
        process.exit(1);
      }
      const parsed = parseISODate(dateStr);
      if (!parsed) {
        console.error(`Error: Invalid date format: ${dateStr}`);
        process.exit(1);
      }
      checkDate = parsed;
      hasExplicitDate = true;
      i += 2;
    } else if (arg === '--forecast' || arg === '-f') {
      const days = parseInt(args[i + 1] ?? '', 10);
      if (isNaN(days) || days <= 0) {
        console.error('Error: --forecast requires a positive number of days');
        process.exit(1);
      }
      forecastDays = days;
      i += 2;
    } else if (arg === '--return-date' || arg === '-r') {
      const dateStr = args[i + 1];
      if (dateStr === undefined || dateStr === '') {
        console.error('Error: --return-date requires a date argument (YYYY-MM-DD)');
        process.exit(1);
      }
      const parsed = parseISODate(dateStr);
      if (!parsed) {
        console.error(`Error: Invalid date format: ${dateStr}`);
        process.exit(1);
      }
      returnDate = parsed;
      i += 2;
    } else if (arg === '--trips' || arg === '-t') {
      showTrips = true;
      i++;
    } else if (arg?.startsWith('-') === true) {
      console.error(`Error: Unknown option: ${arg}`);
      process.exit(1);
    } else if (arg !== undefined && arg !== '' && tripsFile === '') {
      tripsFile = arg;
      i++;
    } else {
      i++;
    }
  }

  return { tripsFile, checkDate, hasExplicitDate, forecastDays, returnDate, showTrips, help };
}

/**
 * Parse an ISO date string (YYYY-MM-DD) to a UTC Date.
 */
function parseISODate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);

  const date = utcDate(year, month, day);

  // Validate the date is real
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

/**
 * Print usage information.
 */
function printHelp(): void {
  console.log(`
UK ILR Absence Calculator

Track absences for Skilled Worker visa holders planning for ILR (Indefinite
Leave to Remain). Implements the GOV.UK rolling 12-month (365-day) window rule:
you cannot exceed 180 days outside the UK in any 365-day period.

Usage:
  bun run src/cli.ts <trips-file> [options]

Arguments:
  trips-file              Path to trips file (required)

Options:
  -d, --date YYYY-MM-DD   Check capacity on specific date (default: today)
  -f, --forecast DAYS     Show capacity forecast for DAYS days
  -r, --return-date DATE  Simulate returning on DATE (for open trips)
  -t, --trips             Show recorded trips list
  -h, --help              Show this help message

Trip File Format:
  dep MM/DD/YY           Departure from UK
  arr MM/DD/YY           Arrival back to UK

  Lines can start with # for comments.
  Final "dep" without "arr" indicates currently abroad.

Examples:
  bun run src/cli.ts trips.txt
  bun run src/cli.ts trips.txt --date 2026-02-01
  bun run src/cli.ts trips.txt --forecast 90
  bun run src/cli.ts trips.txt --return-date 2025-12-20
`);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const { tripsFile, checkDate, hasExplicitDate, forecastDays, returnDate, showTrips, help } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  if (!tripsFile) {
    console.error('Error: No trips file specified');
    console.error('Usage: bun run src/cli.ts <trips-file> [options]');
    console.error('Use --help for more information.');
    process.exit(1);
  }

  // Check if file exists
  const file = Bun.file(tripsFile);
  if (!(await file.exists())) {
    console.error(`Error: File not found: ${tripsFile}`);
    process.exit(1);
  }

  // Parse trips
  let parseResult;
  try {
    parseResult = await parseTripsFile(tripsFile);
  } catch (error: unknown) {
    console.error(`Error parsing trips file: ${String(error)}`);
    process.exit(1);
  }

  const { trips, hasOpenTrip } = parseResult;

  // Handle --return-date: modify the open trip
  let modifiedTrips = trips;
  if (returnDate && hasOpenTrip && trips.length > 0) {
    const lastTrip = trips[trips.length - 1];
    if (lastTrip?.arrival === null) {
      // Validate return date is on or after departure
      if (returnDate < lastTrip.departure) {
        console.error('Error: --return-date must be on or after the departure date');
        process.exit(1);
      }
      // Replace the open trip with a closed one
      modifiedTrips = [...trips.slice(0, -1), { departure: lastTrip.departure, arrival: returnDate }];
      console.log(`Simulating return on ${formatDateReadable(returnDate)}...\n`);
    }
  }

  // Calculate capacity
  const capacity = getCapacity(checkDate, modifiedTrips);

  // Calculate simulation
  let simulation = null;
  let simulationStartDate: Date | null = null;

  if (returnDate && hasExplicitDate) {
    // If both --return-date and --date specified, simulate departing on checkDate
    simulation = simulateContinuousTrip(checkDate, modifiedTrips);
    simulationStartDate = checkDate;
  } else if (hasOpenTrip && !returnDate && trips.length > 0) {
    // Open trip: simulate from departure date
    const lastTrip = trips[trips.length - 1];
    if (lastTrip) {
      simulation = simulateContinuousTrip(lastTrip.departure, trips);
      simulationStartDate = lastTrip.departure;
    }
  }

  // Output
  if (forecastDays !== null) {
    // Show forecast
    const forecast = getCapacityForecast(checkDate, modifiedTrips, forecastDays);
    console.log(formatForecast(forecast, forecastDays <= 31));
  } else if (showTrips) {
    // Show detailed summary with trips
    console.log(formatSummary(checkDate, modifiedTrips, capacity, simulation, hasOpenTrip && !returnDate));
  } else {
    // Show basic capacity
    console.log(formatHeader());
    console.log('');
    console.log(formatCapacity(capacity));

    if (simulation && simulationStartDate) {
      console.log('');
      console.log('─'.repeat(50));
      console.log(formatSimulation(simulation, simulationStartDate));
    }

    console.log('');
    console.log('─'.repeat(50));
    const tripStatus = hasOpenTrip && !returnDate ? ' (1 ongoing)' : '';
    console.log(`Trips: ${modifiedTrips.length} recorded${tripStatus}`);
    console.log('Use --trips to see trip details, --forecast N for projections');
  }
}

// Run
main().catch((error: unknown) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
