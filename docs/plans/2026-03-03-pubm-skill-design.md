# pubm Claude Code Skill Design

## Goal

Create a Claude Code skill that enables AI agents to help developers publish packages using pubm. The skill supports onboarding, configuration, interactive publishing, CI/CD setup, and troubleshooting.

## Target Users

Developers who may be encountering pubm for the first time. The skill should onboard them from zero to publishing.

## Approach

**Approach 3: Main SKILL.md + references/ directory**

```
pubm/
└── .claude/skills/
    └── pubm/
        ├── SKILL.md
        └── references/
            ├── cli-options.md
            ├── config-examples.md
            └── ci-templates.md
```

## Trigger Conditions

- **Automatic**: Keywords like "publish", "release", "deploy package", "npm publish", "jsr publish", "cargo publish"
- **Explicit**: `/pubm` slash command

## SKILL.md Structure

### Frontmatter

```yaml
name: pubm
description: >
  Publish packages to multiple registries (npm, jsr, crates.io) using pubm.
  TRIGGER when: user mentions "publish", "release", "deploy package",
  "npm publish", "jsr publish", "cargo publish", or asks to set up pubm.
  DO NOT TRIGGER when: unrelated to package publishing.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
```

### Role

Package publishing assistant that:
- Sets up pubm in projects
- Publishes packages to npm, jsr, crates.io, or private registries
- Configures CI/CD pipelines
- Troubleshoots publishing issues
- Always confirms before executing irreversible actions
- Provides guidance when user declines execution

### Context

Overview of pubm including:
- Multi-registry publishing tool (npm, jsr, crates.io, custom)
- Supported ecosystems: JS (package.json/jsr.json), Rust (Cargo.toml)
- Core pipeline: prerequisite check → conditions → version bump → publish → rollback on failure
- Two usage modes: CLI (`pubm [version] [options]`) and programmatic API
- Config system: `pubm.config.ts` with `defineConfig()`
- Detailed options/examples are in references/

### Workflow

#### Step 1: Intent Detection

Classify user intent into:
- A) Onboarding/Setup
- B) Publish Execution
- C) CI/CD Setup
- D) Troubleshooting

#### Step 2A: Onboarding/Setup

1. Detect project ecosystem (package.json → JS, Cargo.toml → Rust)
2. Check/install pubm
3. Ask target registries
4. Generate `pubm.config.ts` (reference: config-examples.md)
5. Add `.pubm/` to `.gitignore`
6. Add release scripts to package.json

#### Step 2B: Publish Execution

1. Check project state (git clean, branch, config exists)
2. Run `pubm --preview` for dry-run
3. Ask user for confirmation
4. If approved: execute `pubm [version]`
5. If declined: provide command guide

#### Step 2C: CI/CD Setup

1. Identify CI platform (default: GitHub Actions)
2. Select template from references/ci-templates.md
3. Generate workflow file
4. Guide secret configuration (NPM_TOKEN, CARGO_REGISTRY_TOKEN, etc.)

#### Step 2D: Troubleshooting

1. Analyze error messages
2. Check common causes (permissions, network, version conflicts)
3. Propose solutions

### Safety

- Always run `--preview` before actual publish
- Never publish without user confirmation
- `--publish-only` only in CI context

## References Files

### cli-options.md

- Full CLI option table (flag, type, default, description)
- Common usage combinations
- Programmatic API Options interface

### config-examples.md

- Single JS package (npm + jsr)
- Single Rust crate (crates.io)
- Monorepo (JS + Rust mixed, independent versioning)
- Private registry inclusion
- Custom build/test commands

### ci-templates.md

- GitHub Actions: manual trigger (`workflow_dispatch`) publish
- GitHub Actions: tag-based auto publish
- Required secrets list and setup instructions
- `--publish-only` mode usage
