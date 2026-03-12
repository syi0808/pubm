# pubm Plugin Information for Coding Agents

This file describes the checked-in `pubm plugin` bundle for coding agents.

## Purpose

The `pubm plugin` bundle gives coding agents a repository-local integration surface for release work.

It is meant to:

- encode setup and publish workflows in checked-in assets
- keep release automation close to the repository that owns the workflow
- reduce vague natural-language release prompts

## Location

- `plugins/pubm-plugin/`

## Included parts

- `plugins/pubm-plugin/.claude-plugin/plugin.json`: Claude Code plugin manifest
- `plugins/pubm-plugin/skills/publish-setup/SKILL.md`: setup flow for installing and configuring `pubm`
- `plugins/pubm-plugin/skills/publish-preview/SKILL.md`: preview-first release inspection
- `plugins/pubm-plugin/skills/publish/SKILL.md`: guarded publish flow
- `plugins/pubm-plugin/skills/version-sync/SKILL.md`: external version reference discovery and wiring
- `plugins/pubm-plugin/skills/create-plugin/SKILL.md`: scaffold a new `pubm` plugin package

## How agents should use it

- start with `publish-setup` when the repository is not wired yet
- use skills to orchestrate `pubm` commands rather than replacing them
- inspect changesets and repository state before publishing
- use preview and validation flows before irreversible actions

## Relevant commands

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

## Claude Code installation model

Claude Code's plugin installation model is marketplace-based.

Typical flow:

```text
/plugin marketplace add your-org/claude-plugins
/plugin install plugin-name@marketplace-name
```

Scopes:

- User scope: install across projects for one user
- Project scope: share through the repository
- Local scope: install only in the current repository

## Related files and docs

- `/pubm/INFORMATION.md`
- `/pubm/guides/coding-agents/`
- `/pubm/reference/official-plugins/`
