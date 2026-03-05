---
description: Publish package to registries with pubm (preview-first safety)
argument-hint: [version]
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Publish Package

Publish the current package using pubm. Always runs `--preview` first for safety.

## Instructions

1. **Check project state**:
   - Run `git status --porcelain` to verify working tree is clean
   - Verify pubm is installed: `npx pubm --version`
   - Check if a pubm config file exists (glob for `pubm.config.*`)

2. **Determine version**: Use `$ARGUMENTS` if provided (e.g., `patch`, `minor`, `major`, `1.2.3`). If empty, pubm will prompt interactively.

3. **Run preview first**:
   ```bash
   npx pubm $ARGUMENTS --preview
   ```
   Display the output to the user.

4. **Ask for confirmation**: Ask the user if they want to proceed with the actual publish.

5. **If confirmed**: Run `npx pubm $ARGUMENTS` and monitor the output.

6. **If declined**: Output the exact command the user can run manually:
   ```
   npx pubm $ARGUMENTS
   ```

7. **If publish fails**: Read the error output and provide troubleshooting guidance based on the error message.

## Safety Rules

- NEVER run `pubm` without `--preview` first
- NEVER proceed without explicit user confirmation
- If the working tree is dirty, warn the user and ask them to commit or stash first
