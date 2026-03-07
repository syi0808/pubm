---
name: publish-preview
description: Dry-run publish to see what pubm will do without executing
argument-hint: [version]
allowed-tools:
  - Bash
  - Read
---

# Publish Preview (Dry Run)

Run pubm in preview mode to see the publish plan without actually executing it. No packages are published, no versions are bumped, no git tags are created.

## Workflow

1. Verify pubm is installed: `npx pubm --version`
2. Run the preview:
   ```bash
   npx pubm $ARGUMENTS --preview
   ```
3. Display the output and explain what each step would do.
4. If the user wants to proceed with the actual publish, suggest using the `publish` skill.
