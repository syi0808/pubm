# pubm Claude Code Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Claude Code skill (`.claude/skills/pubm/`) that enables AI agents to set up, configure, publish, and troubleshoot packages using pubm.

**Architecture:** Single `SKILL.md` with intent-based workflow branching (setup / publish / CI / troubleshoot), plus three reference files for CLI options, config examples, and CI templates. The skill lives inside the pubm repository so it ships with `pubm` itself.

**Tech Stack:** Markdown (SKILL.md frontmatter + semantic sections), YAML frontmatter for Claude Code skill metadata.

---

### Task 1: Create directory structure

**Files:**
- Create: `.claude/skills/pubm/` (directory)
- Create: `.claude/skills/pubm/references/` (directory)

**Step 1: Create directories**

```bash
mkdir -p .claude/skills/pubm/references
```

**Step 2: Commit**

```bash
git add .claude/skills/pubm
git commit -m "chore: scaffold pubm skill directory structure"
```

---

### Task 2: Write `references/cli-options.md`

**Files:**
- Create: `.claude/skills/pubm/references/cli-options.md`
- Reference: `src/cli.ts` (CLI flags), `src/types/options.ts` (Options interface), `docs/cli.md` (existing docs)

**Step 1: Write the file**

Content must include:

1. **CLI Usage** section — `pubm [version] [options]`, version can be `major | minor | patch | premajor | preminor | prepatch | prerelease | 1.2.3`
2. **Options table** — every flag from `src/cli.ts:34-120` with: flag, alias, type, default, description. Flags:
   - `--test-script <script>` (String, default: `test`)
   - `--build-script <script>` (String, default: `build`)
   - `-p, --preview` (Boolean, default: false)
   - `-b, --branch <name>` (String, default: `main`)
   - `-a, --any-branch` (Boolean, default: false)
   - `--no-pre-check` (Boolean)
   - `--no-condition-check` (Boolean)
   - `--no-tests` (Boolean)
   - `--no-build` (Boolean)
   - `--no-publish` (Boolean)
   - `--no-release-draft` (Boolean)
   - `--publish-only` (Boolean)
   - `-t, --tag <name>` (String, default: `latest`)
   - `-c, --contents <path>` (String)
   - `--no-save-token` (Boolean)
   - `--registry <...registries>` (String, default: `npm,jsr`)
3. **Common combinations** section — useful flag combos:
   - Dry-run: `pubm patch --preview`
   - npm-only beta: `pubm minor --registry npm --tag beta`
   - Skip tests: `pubm patch --no-tests`
   - CI publish: `pubm --publish-only --registry npm,jsr`
   - No publish (version bump only): `pubm patch --no-publish`
4. **Programmatic API** section — the `Options` interface from `src/types/options.ts` with all fields and their types/defaults
5. **Environment variables** section — `NODE_AUTH_TOKEN`, `JSR_TOKEN`, `CARGO_REGISTRY_TOKEN`

**Step 2: Commit**

```bash
git add .claude/skills/pubm/references/cli-options.md
git commit -m "docs: add CLI options reference for pubm skill"
```

---

### Task 3: Write `references/config-examples.md`

**Files:**
- Create: `.claude/skills/pubm/references/config-examples.md`
- Reference: `src/types/config.ts` (PubmConfig, PackageConfig), `src/config/loader.ts` (defineConfig, config file search order)

**Step 1: Write the file**

Content must include:

1. **Config file basics** — search order: `pubm.config.ts` → `.mts` → `.cts` → `.js` → `.mjs` → `.cjs`. Uses `defineConfig()` from `pubm`.
2. **Example: Single JS package (npm + jsr)**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     registries: ['npm', 'jsr'],
   })
   ```
3. **Example: Single JS package (npm only)**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     registries: ['npm'],
   })
   ```
4. **Example: Single Rust crate**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     registries: ['crates'],
   })
   ```
5. **Example: Monorepo (JS + Rust, independent versioning)**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     versioning: 'independent',
     packages: [
       { path: 'packages/my-lib', registries: ['npm', 'jsr'] },
       { path: 'crates/my-crate', registries: ['crates'] },
     ],
   })
   ```
6. **Example: Private registry**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     registries: ['npm', 'https://registry.mycorp.com'],
   })
   ```
7. **Example: Custom build/test commands**
   ```typescript
   import { defineConfig } from 'pubm'

   export default defineConfig({
     versioning: 'independent',
     packages: [
       {
         path: 'packages/ui',
         registries: ['npm'],
         buildCommand: 'pnpm run build:ui',
         testCommand: 'pnpm run test:ui',
       },
     ],
   })
   ```
8. **PubmConfig type reference** — full interface from `src/types/config.ts`
9. **PackageConfig type reference** — full interface

**Step 2: Commit**

```bash
git add .claude/skills/pubm/references/config-examples.md
git commit -m "docs: add config examples reference for pubm skill"
```

---

### Task 4: Write `references/ci-templates.md`

**Files:**
- Create: `.claude/skills/pubm/references/ci-templates.md`
- Reference: `src/cli.ts` (CI behavior, `--publish-only`)

**Step 1: Write the file**

Content must include:

1. **How pubm works in CI** — overview: pubm detects CI via `std-env`, disables interactive prompts, requires `--publish-only` or explicit version. Auth via environment variables.
2. **Required secrets** — table:
   - `NPM_TOKEN` / `NODE_AUTH_TOKEN` — npm automation token
   - `JSR_TOKEN` — jsr auth token
   - `CARGO_REGISTRY_TOKEN` — crates.io API token
   - How to create each token (brief instructions)
3. **Template: GitHub Actions — Manual trigger (`workflow_dispatch`)**
   ```yaml
   name: Publish
   on:
     workflow_dispatch:
       inputs:
         version:
           description: 'Version to publish (e.g., patch, minor, major, 1.2.3)'
           required: true
           type: string
   jobs:
     publish:
       runs-on: ubuntu-latest
       permissions:
         contents: write
         id-token: write
       steps:
         - uses: actions/checkout@v4
           with:
             fetch-depth: 0
         - uses: actions/setup-node@v4
           with:
             node-version: '20'
             registry-url: 'https://registry.npmjs.org'
         - run: npm install -g pubm
         - run: pubm ${{ github.event.inputs.version }} --publish-only
           env:
             NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```
4. **Template: GitHub Actions — Tag-based auto publish**
   ```yaml
   name: Publish on Tag
   on:
     push:
       tags:
         - 'v*'
   jobs:
     publish:
       runs-on: ubuntu-latest
       permissions:
         contents: write
         id-token: write
       steps:
         - uses: actions/checkout@v4
           with:
             fetch-depth: 0
         - uses: actions/setup-node@v4
           with:
             node-version: '20'
             registry-url: 'https://registry.npmjs.org'
         - run: npm install -g pubm
         - run: pubm --publish-only
           env:
             NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```
5. **Multi-registry CI example** — npm + jsr + crates with all secrets
6. **Notes** — `--publish-only` skips version bump and tag creation (assumes already tagged), `id-token: write` is needed for npm provenance

**Step 2: Commit**

```bash
git add .claude/skills/pubm/references/ci-templates.md
git commit -m "docs: add CI templates reference for pubm skill"
```

---

### Task 5: Write `SKILL.md`

**Files:**
- Create: `.claude/skills/pubm/SKILL.md`
- Reference: all `references/*.md` files, `src/cli.ts`, `src/types/options.ts`, `src/types/config.ts`, `src/config/loader.ts`

**Step 1: Write the SKILL.md**

The file must follow this exact structure:

**A. YAML Frontmatter:**
```yaml
---
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
---
```

**B. `<role>` section:**
Define the agent as a package publishing assistant powered by pubm. Key responsibilities:
- Set up pubm in projects (install, configure, auth)
- Publish packages to npm, jsr, crates.io, or private registries
- Configure CI/CD pipelines for automated publishing
- Troubleshoot publishing issues
- Always confirm before executing irreversible actions (actual publish)
- When user declines execution, provide clear step-by-step guidance instead

**C. `<context>` section:**
Overview of pubm for the agent. Include:
- What pubm is: CLI tool + library for publishing packages to multiple registries simultaneously
- Supported registries: `npm`, `jsr`, `crates` (crates.io), custom URL (private registries)
- Supported ecosystems: JS (`package.json` / `jsr.json`), Rust (`Cargo.toml`)
- Core publish pipeline: prerequisites check → conditions check → version/tag prompts → test & build → version bump + git tag → publish (concurrent to all registries) → git push → GitHub release draft. Auto-rollback on failure.
- Two usage modes: CLI (`pubm [version] [options]`) and programmatic (`import { pubm } from 'pubm'`)
- Config system: `pubm.config.ts` with `defineConfig()` — supports single package and monorepo
- Point to `references/cli-options.md`, `references/config-examples.md`, `references/ci-templates.md` for detailed info
- Token storage: JSR tokens encrypted in `.pubm/` directory (AES-256-CBC); npm uses npm CLI auth; crates uses `CARGO_REGISTRY_TOKEN` or `~/.cargo/credentials.toml`

**D. `<workflow>` section:**
Structured as steps with branching:

**Step 1: Intent Detection**
Analyze user message and classify into:
- A) Onboarding/Setup — "set up pubm", "install pubm", "configure publishing"
- B) Publish Execution — "publish this package", "release new version", "deploy to npm"
- C) CI/CD Setup — "set up CI for publishing", "GitHub Actions for release"
- D) Troubleshooting — "publish failed", error messages, debugging

**Step 2A: Onboarding/Setup Workflow**
1. Detect ecosystem: check for `package.json` (JS) or `Cargo.toml` (Rust)
2. Check if pubm is installed (`npx pubm --version` or check `package.json` devDependencies). If not, ask user to install: `npm install -D pubm` / `pnpm add -D pubm`
3. Ask user which registries they want to publish to (npm, jsr, crates.io, private)
4. Generate `pubm.config.ts` — read `references/config-examples.md` for the right template
5. Add `.pubm/` to `.gitignore` if not already present
6. Add `"release": "pubm"` and `"ci:release": "pubm --publish-only"` to `package.json` scripts (for JS projects)
7. Present summary of what was set up

**Step 2B: Publish Execution Workflow**
1. Check project state:
   - Is git working tree clean? (`git status --porcelain`)
   - Is pubm installed? (`npx pubm --version`)
   - Does config exist? (check for `pubm.config.*`)
2. Run `npx pubm [version] --preview` to show dry-run. Display output to user.
3. Ask user: "The preview looks good. Shall I proceed with the actual publish?"
4. If YES: run `npx pubm [version]` (pass through any user-specified flags)
5. If NO: output the exact command the user should run manually, with explanation of each flag
6. If publish fails: check error output, suggest fixes (see Step 2D)

**Step 2C: CI/CD Setup Workflow**
1. Ask: which CI platform? (default GitHub Actions)
2. Ask: trigger method? (manual `workflow_dispatch` / tag-based / both)
3. Read `references/ci-templates.md` for the appropriate template
4. Create `.github/workflows/publish.yml` (or equivalent)
5. List required secrets and how to set them:
   - npm: `NPM_TOKEN` — create at npmjs.com → Access Tokens → Automation
   - jsr: `JSR_TOKEN`
   - crates: `CARGO_REGISTRY_TOKEN` — create at crates.io → API Tokens
6. Present summary and remind user to add secrets in GitHub Settings → Secrets

**Step 2D: Troubleshooting Workflow**
1. Read error message from user
2. Common issues and fixes:
   - "Not logged in" → `npm login` or check `NODE_AUTH_TOKEN`
   - "Permission denied" → check npm org/team permissions
   - "Version already published" → bump version or check registry
   - "Branch mismatch" → use `--any-branch` or switch to release branch
   - "Working tree not clean" → commit or stash changes
   - "Registry unreachable" → check network, VPN, registry URL
   - "OTP required" → use `--publish-only` in CI or enter OTP interactively
3. If error is unknown: suggest running `pubm [version] --preview` to isolate the failing step

**E. `<constraints>` section:**
- NEVER run `pubm` (without `--preview`) without explicit user confirmation
- Always run `--preview` first to show what will happen
- Do not fabricate CLI options or config fields — reference only what exists in `references/cli-options.md`
- When creating config files, always use `defineConfig()` for type safety
- Add `.pubm/` to `.gitignore` when setting up (contains encrypted tokens)
- For CI, always remind user about required secrets
- If unsure about the user's intended registries, ask — don't assume

**F. `<references>` section:**
- `references/cli-options.md` — Complete CLI flag reference and programmatic API
- `references/config-examples.md` — Config file templates for various project setups
- `references/ci-templates.md` — CI/CD pipeline templates and secret setup guide

**Step 2: Commit**

```bash
git add .claude/skills/pubm/SKILL.md
git commit -m "feat: add pubm Claude Code skill"
```

---

### Task 6: Verify skill structure

**Files:**
- Read: `.claude/skills/pubm/SKILL.md`
- Read: `.claude/skills/pubm/references/cli-options.md`
- Read: `.claude/skills/pubm/references/config-examples.md`
- Read: `.claude/skills/pubm/references/ci-templates.md`

**Step 1: Verify all files exist**

```bash
find .claude/skills/pubm -type f | sort
```

Expected output:
```
.claude/skills/pubm/SKILL.md
.claude/skills/pubm/references/ci-templates.md
.claude/skills/pubm/references/cli-options.md
.claude/skills/pubm/references/config-examples.md
```

**Step 2: Verify SKILL.md frontmatter is valid**

Check the file starts with `---`, has `name: pubm`, `user-invocable: true`, `allowed-tools` list, and closes with `---`.

**Step 3: Verify all references are reachable**

Read each reference file mentioned in SKILL.md `<references>` section and confirm it exists and has content.

**Step 4: Cross-check CLI options**

Compare flags in `references/cli-options.md` against `src/cli.ts:34-120` to ensure nothing is missing or fabricated.

**Step 5: Cross-check config types**

Compare config examples in `references/config-examples.md` against `src/types/config.ts` to ensure all fields are real.

---

### Task 7: Final commit and summary

**Step 1: Check git status**

```bash
git status
```

Ensure all skill files are committed. If any are uncommitted, stage and commit them.

**Step 2: Verify directory tree**

```bash
tree .claude/skills/pubm/
```

Expected:
```
.claude/skills/pubm/
├── SKILL.md
└── references/
    ├── ci-templates.md
    ├── cli-options.md
    └── config-examples.md
```

**Step 3: Output summary to user**

Report what was created, how to use the skill (`/pubm` or keyword triggers), and suggest testing by starting a new Claude Code session in a sample project.
