# Contributing to pubm

Thank you for your interest in contributing to pubm. This guide explains how to report issues, suggest improvements, and submit code changes.

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

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

- Node.js 18 or later
- Git 2.11.0 or later
- pnpm 9.11.0 or later

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/pubm.git
cd pubm
pnpm install
pnpm build
```

### Useful Commands

```bash
pnpm build        # Build with tsup (outputs ESM/CJS to dist/, CLI to bin/)
pnpm check        # Lint and format check with Biome
pnpm format       # Auto-fix lint and formatting issues
pnpm typecheck    # TypeScript type checking
pnpm test         # Run tests with Vitest
pnpm coverage     # Run tests with coverage report
```

## Style Guide

### Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run the formatter before submitting:

```bash
pnpm format
```

Key conventions:
- 2 spaces indentation, single quotes
- ESM module system (`"type": "module"`)
- TypeScript strict mode

### Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `chore:` — maintenance tasks
- `refactor:` — code refactoring

Keep the first line under 72 characters. Reference issue numbers when applicable.

## Testing

Run the test suite before submitting a pull request:

```bash
pnpm test
```

Tests are located in `tests/unit/` and `tests/e2e/` and use [Vitest](https://vitest.dev/).

To run a specific test file:

```bash
pnpm vitest --run tests/unit/utils/rollback.test.ts
```

Coverage thresholds are strict (95% lines/functions/statements, 90% branches).

## Pre-commit Checklist

Before submitting a pull request, run these checks in order and fix any failures:

1. `pnpm format` — auto-fix lint and formatting issues
2. `pnpm typecheck` — ensure no type errors
3. `pnpm test` — ensure all tests pass
