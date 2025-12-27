# UK ILR Absence Calculator

CLI tool to track UK Skilled Worker visa absences for ILR eligibility.

## Tech Stack
- Runtime: Bun
- Language: TypeScript (strict mode)
- Linting: ESLint (flat config) + Prettier

## Commands
- `bun run check` - Run all checks (typecheck, lint, format)
- `bun test` - Run tests

## Code Style
- Use Bun APIs over Node.js equivalents
- Use `import type {}` for type-only imports

## Before Committing
Run `bun run check` to ensure code passes all checks.

## CLI Usage
```bash
bun run src/cli.ts trips.txt                    # Check capacity today
bun run src/cli.ts trips.txt --date 2026-02-01  # Check on specific date
bun run src/cli.ts trips.txt --forecast 90      # 90-day projection
bun run src/cli.ts trips.txt --return-date 2025-12-20  # Simulate return
```

## Trip File Format
```
dep MM/DD/YY
arr MM/DD/YY
dep MM/DD/YY  <- open trip if no arr follows (currently abroad)
```

## Critical Domain Knowledge
- **Rolling 365-day window** - not calendar year, not tax year
- **Only whole days count** - departure and arrival days are excluded
- **Window boundary**: exclusive start, inclusive end `(checkDate - 365, checkDate]`
- **2024 is a leap year** - affects window calculations (365 days before Jan 10, 2025 = Jan 11, 2024, not Jan 10)
- **"Free travel window"** - when old trip days fall off at the same rate new days accumulate (e.g., Dec 25 - Jan 20 if there was a trip the previous Dec/Jan)

## Testing
82 tests covering parser, calculator, and integration scenarios.
