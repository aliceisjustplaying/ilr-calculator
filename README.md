# UK ILR Absence Calculator

CLI tool to track UK Skilled Worker visa absences for ILR (Indefinite Leave to Remain) eligibility.

## Installation

```bash
bun install
```

## Usage

```bash
# Copy the example file and add your trips
cp trips.txt.example trips.txt

# Check capacity today
bun run src/cli.ts trips.txt

# Check on a specific date
bun run src/cli.ts trips.txt --date 2026-02-01

# Show 90-day forecast
bun run src/cli.ts trips.txt --forecast 90

# Simulate returning on a specific date (for open trips)
bun run src/cli.ts trips.txt --return-date 2025-12-20

# Show all recorded trips
bun run src/cli.ts trips.txt --trips
```

## Trip File Format

```
# Comments start with #
dep 12/24/24
arr 1/21/25
dep 2/4/25
arr 2/12/25
dep 11/26/25    # No arr = currently abroad (open trip)
```

- Dates are in `MM/DD/YY` format
- Each trip needs a `dep` (departure) and `arr` (arrival) line
- The last trip can omit `arr` if you're currently abroad
- Same-day returns are valid (counts as 0 days abroad)

## The Rules

Per [GOV.UK guidance](https://www.gov.uk/indefinite-leave-to-remain-tier-2-t2-skilled-worker-visa/time-uk), you must have spent **no more than 180 days outside the UK in any 12 months** to qualify for ILR.

Key details:
- **Rolling 365-day window** — checked on any date, not calendar years
- **Only whole days count** — departure and arrival days are excluded
- **Window boundary** — exclusive start, inclusive end: the day exactly 365 days ago doesn't count ([source](https://www.visaandmigration.com/public/blog/how-to-calculate-continuous-residence-for-ilr))

For full Home Office guidance on calculating continuous residence, see: [GOV.UK - Calculating continuous period in UK](https://www.gov.uk/government/publications/indefinite-leave-to-remain-calculating-continuous-period-in-uk/indefinite-leave-to-remain-calculating-continuous-period-in-uk-accessible)

## Development

```bash
bun test          # Run tests
bun run check     # Run typecheck + lint + format check
```
