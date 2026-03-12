# pubm Information for Coding Agents

`pubm` is a release orchestrator for repositories that publish to more than one registry, more than one package, or more than one ecosystem.

This file is intended to be plain text context for coding agents and automation systems.

## What pubm does

- manages versioning and publishing across npm, JSR, crates.io, and custom registries
- uses changesets in `.pubm/changesets/` as release input
- can preview, validate, and publish from the CLI
- supports plugins for extra release behavior

## Core workflow

1. initialize the repository with `pubm init`
2. configure target registries in `pubm.config.ts`
3. add a changeset with `pubm changesets add`
4. inspect pending versions with `pubm changesets status --verbose` or `pubm changesets version --dry-run`
5. write versions with `pubm changesets version`
6. validate publishing with `pubm --preflight` if needed
7. publish with `pubm` or an explicit bump such as `pubm patch`

## Important files

- `pubm.config.ts`: repository release configuration
- `.pubm/changesets/`: pending changesets
- `plugins/pubm-plugin/`: coding-agent integration assets for this repository
- `plugins/pubm-plugin/.claude-plugin/plugin.json`: Claude Code plugin manifest
- `plugins/pubm-plugin/skills/`: checked-in skill bundle

## Coding-agent notes

- if the repository uses the checked-in `pubm plugin` bundle, start with the `publish-setup` skill
- skills should orchestrate `pubm` commands, not replace them
- before publishing, agents should inspect repository state and pending changesets
- `pubm --preflight` is the main validation entry point for registry auth and dry-run publish checks

## Common commands

```bash
pubm init
pubm changesets add
pubm changesets status --verbose
pubm changesets version --dry-run
pubm changesets version
pubm --preflight
pubm patch --preview
pubm
```

## Related docs

- `/pubm/PUBM_PLUGIN.md`
- `/pubm/guides/quick-start/`
- `/pubm/guides/coding-agents/`
- `/pubm/guides/configuration/`
- `/pubm/guides/ci-cd/`
- `/pubm/reference/cli/`
