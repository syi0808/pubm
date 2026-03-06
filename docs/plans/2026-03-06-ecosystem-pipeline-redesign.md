# Ecosystem-Driven Pipeline Redesign

**Date:** 2026-03-06
**Status:** Approved

## Problem

The current publish pipeline (runner.ts) is hardcoded to JS ecosystem conventions:

1. `replaceVersion()` only updates `package.json` and `jsr.json` — no `Cargo.toml`
2. `version()` reads only from `package.json` / `jsr.json`
3. Test/build execution uses `getPackageManager()` + `exec(pm, ["run", script])`
4. Script existence check reads `package.json.scripts`
5. Install verification hardcodes npm/jsr checks (ignores cargo)
6. Success message hardcodes `getPackageJson().name` / `getJsrJson().name`
7. Dist-tag prompts query only npm/jsr registries
8. `Ctx` has `npmOnly` / `jsrOnly` flags — no crates awareness
9. `detectWorkspace()` only supports JS workspace formats
10. Changeset/changelog modules exist as libraries but are not integrated into the pipeline

The `Ecosystem` abstraction and `CratesRegistry` already exist but are not wired into the pipeline.

## Design Decisions

- **Runner as orchestrator, Ecosystem as driver** — Runner manages git and orchestration; Ecosystem owns build/test/version/workspace logic
- **Git stays in common layer** — branch checks, tags, push, release draft are language-agnostic
- **`package.ts` fully removed** — all callers migrate to Ecosystem methods directly
- **`Ctx` includes `ecosystem: Ecosystem`** — replaces `npmOnly`/`jsrOnly` flags
- **Changelog integrated into pipeline** — changesets consumed during version bump step

## Architecture

```
Runner (orchestrator)
├── Git layer (common)
│   ├── prerequisites check
│   ├── commit + tag
│   ├── push tags
│   └── release draft
├── Ecosystem (per-language)
│   ├── readVersion() / writeVersion()
│   ├── runTest() / runBuild()
│   ├── hasScript()
│   ├── manifestFiles()
│   ├── packageName()
│   ├── detectWorkspace()
│   ├── discoverPackages()
│   └── supportedRegistries()
└── Registry layer (per-registry)
    ├── ping / publish / version
    └── isInstalled / hasPermission
```

### Pipeline Flow

```
1. Git prerequisites          ← Git layer
2. Required conditions        ← Ecosystem (hasScript) + Registry (ping, install, permission)
3. Version/tag prompts        ← Ecosystem (readVersion) + Registry (distTags)
4. Changeset consumption      ← Changeset module (if changesets exist)
5. Test                       ← Ecosystem.runTest()
6. Build                      ← Ecosystem.runBuild()
7. Version bump               ← Ecosystem.writeVersion() + Git (commit, tag)
8. Publish                    ← Registry.publish() (concurrent)
9. Push tags + release draft  ← Git layer
10. Rollback on failure       ← Git layer + Ecosystem.manifestFiles()
```

## Ecosystem Interface (Extended)

```ts
export abstract class Ecosystem {
  constructor(public packagePath: string) {}

  // Identity
  abstract packageName(): Promise<string>;
  abstract supportedRegistries(): RegistryType[];
  abstract manifestFiles(): string[];

  // Version
  abstract readVersion(): Promise<string>;
  abstract writeVersion(newVersion: string): Promise<void>;

  // Execution
  abstract runTest(script?: string): Promise<void>;
  abstract runBuild(script?: string): Promise<void>;
  abstract hasScript(name: string): Promise<boolean>;

  // Workspace / Monorepo
  abstract detectWorkspace(): WorkspaceInfo | null;
  abstract discoverPackages(): Promise<PackageNode[]>;
}
```

### JsEcosystem

- `runTest(script)` — `getPackageManager()` + `exec(pm, ["run", script || "test"])`
- `runBuild(script)` — `getPackageManager()` + `exec(pm, ["run", script || "build"])`
- `hasScript(name)` — reads `package.json.scripts[name]`
- `detectWorkspace()` — `pnpm-workspace.yaml` / `package.json.workspaces`
- `discoverPackages()` — glob workspace patterns, read each `package.json`
- Absorbs all `package.ts` utilities internally (`getPackageJson`, `getJsrJson`, `findOutFile`, etc.)

### RustEcosystem

- `runTest(script)` — `exec("cargo", ["test"])` (script param ignored or mapped)
- `runBuild(script)` — `exec("cargo", ["build", "--release"])`
- `hasScript(_)` — always returns `true` (cargo has built-in test/build)
- `detectWorkspace()` — reads `Cargo.toml [workspace]` members
- `discoverPackages()` — reads workspace members, each member's `Cargo.toml`

## Runner Context Changes

```ts
// Before
export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  npmOnly: boolean;      // REMOVE
  jsrOnly: boolean;      // REMOVE
  cleanWorkingTree: boolean;
}

// After
export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  ecosystem: Ecosystem;  // NEW
  cleanWorkingTree: boolean;
}
```

## Runner Pipeline Changes

### Test & Build

```ts
// Before
const packageManager = await getPackageManager();
await exec(packageManager, ["run", ctx.testScript], { throwOnError: true });

// After
await ctx.ecosystem.runTest(ctx.testScript);
```

### Version Bump

```ts
// Before
const replaced = await replaceVersion(ctx.version);
for (const replacedFile of replaced) {
  await git.stage(replacedFile);
}

// After
await ctx.ecosystem.writeVersion(ctx.version);
for (const file of ctx.ecosystem.manifestFiles()) {
  await git.stage(file);
}
```

### Script Existence Check (required-conditions-check.ts)

```ts
// Before
const { scripts } = await getPackageJson();
if (!ctx.skipTests && !scripts?.[ctx.testScript]) { ... }

// After
if (!ctx.skipTests && !(await ctx.ecosystem.hasScript(ctx.testScript))) { ... }
```

### Install Verification (required-conditions-check.ts)

```ts
// Before: hardcoded npm/jsr install check
// After: dynamic per-registry check
ctx.registries.map((registryKey) => ({
  title: `Verifying ${registryKey} is available`,
  task: async () => {
    const registry = await getRegistry(registryKey);
    if (!(await registry.isInstalled())) {
      throw new RequiredConditionCheckError(`${registryKey} is not installed`);
    }
  },
}))
```

### Success Message (runner.ts)

```ts
// Before
const npmPackageName = (await getPackageJson()).name;
const jsrPackageName = (await getJsrJson()).name;
console.log(`Published ${npmPackageName} on npm and ${jsrPackageName} on jsr`);

// After
const packageName = await ctx.ecosystem.packageName();
const registryNames = ctx.registries.join(", ");
console.log(`Published ${packageName} on ${registryNames} v${ctx.version}`);
```

### Dist-Tag Prompts (required-missing-information.ts)

```ts
// Before
const distTags = [...new Set((await Promise.all([npm.distTags(), jsr.distTags()])).flat())];

// After
const registries = await Promise.all(
  ctx.registries.map((key) => getRegistry(key))
);
const distTags = [...new Set((await Promise.all(registries.map(r => r.distTags()))).flat())];
```

## Changelog Pipeline Integration

### Current State

- `pubm add` — creates changeset files in `.pubm/changesets/`
- `pubm status` — reads and displays pending changesets
- `pubm version` — **stub** (not implemented)
- Runner — **no changeset integration**

### Integration: Two Modes

#### Mode A: `pubm version` + `pubm` (2-step workflow)

For monorepo projects. `pubm version` consumes changesets and bumps versions, `pubm` publishes.

```
pubm version
├── readChangesets()
├── ecosystem.readVersion() per package
├── calculateVersionBumps()
├── ecosystem.writeVersion() per package
├── generateChangelog() → update CHANGELOG.md
├── delete consumed changeset files
└── git commit (version bump + changelog)
```

#### Mode B: Single `pubm` command (integrated workflow)

For single-package projects. If changesets exist, they are consumed automatically during the version bump step.

```
pubm [version]
├── prerequisites check
├── required conditions check
├── changeset detection:
│   ├── readChangesets() → calculateVersionBumps()
│   ├── auto-determine version (skip user prompt)
│   ├── generateChangelog() → CHANGELOG.md
│   └── delete changeset files
├── test & build (via ecosystem)
├── version bump (via ecosystem) + CHANGELOG.md staged
├── publish (via registry)
└── push tags + release draft
```

### Runner Integration Point

Inside the "Bumping version" task:

```ts
{
  title: "Bumping version",
  task: async (ctx, task) => {
    const eco = ctx.ecosystem;
    const filesToStage = [...eco.manifestFiles()];

    // Consume changesets if present and changelog enabled
    const status = getStatus();
    if (status.hasChangesets && config.changelog !== false) {
      const entries = status.changesets.flatMap(cs =>
        cs.releases.map(r => ({ summary: cs.summary, type: r.type, id: cs.id }))
      );
      const changelog = generateChangelog(ctx.version, entries);
      await updateChangelogFile(changelog, config.changelog);
      await consumeChangesets();
      filesToStage.push("CHANGELOG.md", ".pubm/changesets/");
    }

    await eco.writeVersion(ctx.version);

    for (const file of filesToStage) {
      await git.stage(file);
    }

    // git commit + tag (unchanged)
  }
}
```

### Config Control

`PubmConfig.changelog` already exists:
- `false` — skip changelog generation
- `true` — default `CHANGELOG.md` path
- `"path/to/CHANGELOG.md"` — custom path

## Monorepo Integration

### Current Gap

`detectWorkspace()` in `src/monorepo/workspace.ts` only supports JS formats (pnpm-workspace.yaml, package.json workspaces).

### Design

Move workspace detection into Ecosystem:

- `JsEcosystem.detectWorkspace()` — current JS logic
- `RustEcosystem.detectWorkspace()` — reads `Cargo.toml` `[workspace]` section

`PackageNode` extended with ecosystem reference:

```ts
export interface PackageNode {
  name: string;
  version: string;
  path: string;
  dependencies: Record<string, string>;
  ecosystem: Ecosystem;  // NEW — enables mixed monorepos
}
```

`buildDependencyGraph()` and `topologicalSort()` remain ecosystem-agnostic (already work with `PackageNode[]`).

## package.ts Migration

| Function | Current Users | Migration Target |
|----------|--------------|-----------------|
| `getPackageJson()` | runner, required-conditions-check, jsr tasks | `JsEcosystem` internal |
| `getJsrJson()` | runner, jsr tasks | `JsEcosystem` internal |
| `version()` | cli.ts | `ecosystem.readVersion()` |
| `replaceVersion()` | runner | `ecosystem.writeVersion()` |
| `findOutFile()` | package.ts internal | `JsEcosystem` internal utility |
| `patchCachedJsrJson()` | jsr tasks | `JsEcosystem` internal |
| `packageJsonToJsrJson()` | jsr file generation | `JsEcosystem` internal |
| `jsrJsonToPackageJson()` | jsr file generation | `JsEcosystem` internal |

## Error Handling & Rollback

Rollback remains git-based (common layer). Changes:
- Version bump rollback uses `ecosystem.manifestFiles()` to know which files were changed
- `Cargo.toml` included in rollback targets for Rust projects
- Changeset files restored on rollback (re-create deleted files)

## Out of Scope

- Mixed-ecosystem monorepos (JS + Rust in one workspace) — future enhancement
- Cargo workspace publishing order (respecting internal crate dependencies) — future
- Interactive `pubm add` for Rust packages — future
