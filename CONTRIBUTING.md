# Contributing to pubm

Thank you for your interest in contributing to pubm. This guide covers bug reports, enhancement requests, and code changes.

## Code of Conduct

Be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/syi0808/pubm/issues) to check if the bug has already been reported
2. If not, open a new issue with:
   - Steps to reproduce the bug
   - Expected behavior vs. actual behavior
   - Your environment (OS, Node.js version, package manager)
   - Terminal output or screenshots if applicable

### Suggesting Enhancements

1. Search [existing issues](https://github.com/syi0808/pubm/issues) for similar suggestions
2. Open a new issue describing:
   - The problem or use case
   - Your proposed solution
   - Alternatives you considered

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main` (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run the pre-commit checklist (see below)
5. Push to your fork and open a pull request
6. Fill in the PR description explaining what changed and why

## Development Setup

### Requirements

- Node.js 24 or later
- Git 2.11.0 or later
- Bun 1.3.11 or later

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/pubm.git
cd pubm
bun install
bun run build
```

### Useful Commands

```bash
bun run build        # Build all packages via Turborepo
bun run check        # Lint and format check with Biome
bun run format       # Auto-fix lint and formatting issues
bun run typecheck    # TypeScript type checking
bun run test         # Run tests with Vitest
bun run coverage     # Run tests with coverage report
```

## Style Guide

### Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run the formatter before submitting:

```bash
bun run format
```

Key conventions:
- 2 spaces indentation, double quotes
- ESM module system (`"type": "module"`)
- TypeScript strict mode

### Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:`: new feature
- `fix:`: bug fix
- `docs:`: documentation changes
- `chore:`: maintenance tasks
- `refactor:`: code refactoring

Keep the first line under 72 characters. Reference issue numbers when applicable.

## Testing

Run the test suite before submitting a pull request:

```bash
bun run test
```

Tests are located in `tests/unit/` and `tests/e2e/` within each package, and use [Vitest](https://vitest.dev/).

To run a specific test file:

```bash
cd packages/core && bun vitest --run tests/unit/utils/rollback.test.ts
```

Coverage thresholds are 95% lines/functions/statements and 90% branches.

## Pre-commit Checklist

Before submitting a pull request, run these checks in order and fix any failures:

1. `bun run format`: auto-fix lint and formatting issues
2. `bun run typecheck`: ensure no type errors
3. `bun run test`: ensure all tests pass
4. `bun run coverage`: ensure coverage thresholds are met
