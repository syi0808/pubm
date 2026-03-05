# pubm Plugin & Marketplace Design

## Goal

Create a standalone Claude Code plugin for pubm and a personal marketplace repo, both inside `plugins/` directory of the pubm project.

## Structure

### Marketplace with Plugin (`plugins/marketplace/`)

Plugin lives inside the marketplace directory (path traversal `..` is not allowed in marketplace sources).

```
plugins/marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── pubm-plugin/
        ├── .claude-plugin/
        │   └── plugin.json
        ├── skills/
        │   └── pubm/
        │       ├── SKILL.md
        │       └── references/
        │           ├── cli-options.md
        │           ├── config-examples.md
        │           └── ci-templates.md
        └── commands/
            ├── publish.md
            ├── publish-preview.md
            └── publish-setup.md
```

## Plugin Details

### plugin.json

```json
{
  "name": "pubm-plugin",
  "description": "Publish packages to multiple registries (npm, jsr, crates.io) with pubm",
  "version": "1.0.0",
  "author": { "name": "pubm" },
  "keywords": ["publish", "npm", "jsr", "crates", "registry"],
  "category": "devtools"
}
```

### Skill: pubm (auto-triggered)

Based on existing `.claude/skills/pubm/SKILL.md`. Triggers on publish-related keywords. Covers:
- Onboarding/Setup
- Publish Execution (always preview first)
- CI/CD Setup
- Troubleshooting

### Commands

1. `/pubm-plugin:publish [version]` — Run publish with preview-first safety
2. `/pubm-plugin:publish-preview [version]` — Dry-run only
3. `/pubm-plugin:publish-setup` — Interactive project setup

## Marketplace

`marketplace.json` references pubm-plugin via `"source": "./plugins/pubm-plugin"`.

### Installation

Local:
```shell
/plugin marketplace add ./plugins/marketplace
/plugin install pubm-plugin@pubm-marketplace
```

GitHub (after push):
```shell
/plugin marketplace add owner/pubm
/plugin install pubm-plugin@pubm-marketplace
```

## Decisions

- Plugin name: `pubm-plugin` (namespaced commands: `/pubm-plugin:publish`)
- Marketplace name: `pubm-marketplace`
- Location: `plugins/` directory inside pubm repo
- Skill content: migrated from existing `.claude/skills/pubm/`
- Commands: 3 slash commands for common workflows
