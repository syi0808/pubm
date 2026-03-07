---
name: publish
description: Publish package to registries with pubm (preview-first safety)
argument-hint: [version]
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Publish Package

pubm is a CLI tool for publishing packages to multiple registries (npm, jsr, crates.io) simultaneously. It handles the entire release lifecycle: version bumping, git tagging, parallel publishing, and rollback on failure.

## Core Pipeline

When you run `pubm [version]`, the following pipeline executes in order:

1. **Prerequisites check** -- validates branch, remote status, clean working tree
2. **Required conditions check** -- pings registries, validates login/permissions
3. **Version/tag prompts** -- interactive prompts for version and dist-tag (skipped in CI/non-TTY)
4. **Test and Build** -- runs configured npm scripts (`test`, `build`)
5. **Version bump** -- updates `package.json`/`jsr.json`/`Cargo.toml`, creates git commit + tag
6. **Publish** -- publishes concurrently to all configured registries
7. **Post-publish** -- pushes tags to remote, creates GitHub release draft
8. **Rollback on failure** -- if any publish step fails, auto-reverses git operations (tag, commit)

## Workflow

### 1. Check project state

- Run `git status --porcelain` to verify working tree is clean
- Verify pubm is installed: `npx pubm --version`
- Check if a pubm config file exists (glob for `pubm.config.*`)

### 2. Determine version

Use `$ARGUMENTS` if provided (e.g., `patch`, `minor`, `major`, `1.2.3`). If empty, pubm will prompt interactively.

Accepted values: `major`, `minor`, `patch`, `premajor`, `preminor`, `prepatch`, `prerelease`, or an explicit semver string.

### 3. Run preview first

```bash
npx pubm $ARGUMENTS --preview
```

Display the output to the user.

### 4. Ask for confirmation

Use AskUserQuestion to ask the user if they want to proceed with the actual publish.

### 5. If confirmed

Run `npx pubm $ARGUMENTS` with any additional flags the user specified. Consult `references/cli-options.md` for available flags. If the project uses non-standard script names, add `--test-script <name>` and/or `--build-script <name>`. Monitor the output.

### 6. If declined

Output the exact command the user can run manually:

```
npx pubm $ARGUMENTS
```

### 7. If publish fails

Read the error output and consult `references/troubleshooting.md` for diagnosis and fixes.

## Safety Rules

- NEVER run `pubm` without `--preview` first
- NEVER proceed without explicit user confirmation
- If the working tree is dirty, warn the user and ask them to commit or stash first
- Do not fabricate CLI options. Reference only flags documented in `references/cli-options.md`

## References

- `references/cli-options.md` -- Complete CLI flag reference, programmatic API, environment variables
- `references/troubleshooting.md` -- Common errors and fixes
