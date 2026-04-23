# Config V1 And Loader Design

**Date:** 2026-04-23  
**Status:** Draft  
**Scope:** Canonical grouped config model for the post-migration public surface, current-field mapping, loader boundary, migration/deprecation rules, and open risks.

**Depends on:**

- [release-platform-architecture](./2026-04-22-release-platform-architecture.md)
- [external-interface-v1](./2026-04-22-external-interface-v1.md)
- [visual-architecture-and-interface](./2026-04-22-visual-architecture-and-interface.md)
- [low-level-migration-scope-plan](./2026-04-22-low-level-migration-scope-plan.md)
- [plan-slice-detailed-design](./2026-04-22-plan-slice-detailed-design.md)
- [publish-slice-detailed-design](./2026-04-22-publish-slice-detailed-design.md)
- [pubm-self-hosting-pipeline-comparison](./2026-04-22-pubm-self-hosting-pipeline-comparison.md)

## Goal

This document turns the 2026-04-22 public-shape sketch into a concrete config and loader design.

The target outcome is:

- one canonical grouped config model for authoring and normalization
- one explicit loader output that acts as the composition-layer policy snapshot
- no package discovery, version planning, or publish-time inference inside config loading
- a field-by-field migration path from today's flat `PubmConfig`

This design keeps the hard boundary from [release-platform-architecture](./2026-04-22-release-platform-architecture.md):

- config is composition/policy input
- `PlanRequest`, `ReleasePlan`, `ReleaseRecord`, and `PublishRun` remain typed artifacts
- runtime/session state stays out of domain contracts

## Scope Boundary

In scope:

- canonical grouped config shape
- normalization rules from current fields to grouped paths
- loader output contract
- loader vs planner vs runtime responsibilities
- deprecation and conflict-resolution rules

Out of scope:

- final plugin API redesign
- final `Artifact` type
- final `ExecutionState` storage format
- implementation changes outside this document

## Design Summary

The grouped top-level shape remains the one introduced in [external-interface-v1](./2026-04-22-external-interface-v1.md) and [visual-architecture-and-interface](./2026-04-22-visual-architecture-and-interface.md):

- `workflow`
- `release`
- `packages`
- `targets`
- `validation`
- `recovery`
- `plugins`

This doc completes the parts those sketches left implicit:

- `packages` is a real group, not only a bare array
- `targets` normalizes to keyed target definitions with open category strings and target refs, not only string arrays
- runtime-only preferences are split out of the policy snapshot during loading

## Closed Core, Open Edge Rule

This design keeps engine lifecycle vocabulary and product-owned root commands closed where the core owns the semantics, but it keeps workflow selection, proposal binding, target binding, policy binding, and plugin binding open at the loader boundary.

- built-in authoring groups such as `registries`, `distributions`, and `closeout` may remain as input sugar
- normalized target data should lower to keyed definitions with `targetKey`, `targetCategory`, `targetRef`, and optional `contractRef`
- planner and publish should branch on capabilities and contract refs, not on an exhaustive target-kind enum baked into config loading

## Loader Boundary

```mermaid
flowchart LR
  A["pubm.config.*"] --> B["ConfigLoader"]
  B --> C["LoadedConfigV1"]
  C --> D["PlanRequest composition"]
  D --> E["Planner"]
  E --> F["ReleasePlan"]
  F --> G["Release / Publish runtime"]
```

`LoadedConfigV1` is the config-side equivalent of the `Policy Snapshot` node in [release-platform-architecture](./2026-04-22-release-platform-architecture.md).

It is not a release plan, and it must not contain discovered package versions, mutable runtime flags, or hydrated secrets.

## Canonical Model

### Author-facing grouped shape

```ts
export default defineConfig({
  workflow: {
    ref: "builtin:release-pr",
    branch: "main",
    proposalRef: "builtin:release-pr",
  },

  release: {
    versioning: {
      strategyRef: "builtin:versioning/independent",
      sourceRef: "builtin:version-source/all",
      groups: {
        fixed: [],
        linked: [],
      },
      updateInternalDependencies: "patch",
      snapshotTemplate: "{tag}-{timestamp}",
      registryQualifiedTags: false,
      conventionalCommits: {
        types: {},
      },
    },
    changelog: {
      enabled: true,
      rendererRef: "builtin:changelog/default",
    },
    materialization: {
      commit: false,
      lockfileSync: "optional",
    },
    selection: {
      excludeRelease: [],
    },
  },

  packages: {
    include: [
      {
        path: "packages/core",
        ecosystem: "js",
        targets: {
          registries: ["npm", "jsr"],
        },
      },
    ],
    ignore: [],
    ecosystems: {
      js: {
        scripts: {
          test: { script: "test" },
          build: { script: "build" },
        },
      },
    },
  },

  targets: {
    registries: {
      defaults: {
        access: "public",
        tag: "latest",
        contents: ".",
      },
      definitions: {
        npm: {
          ref: "builtin:npm",
          contractRef: "pubm.publish.package-registry/v1",
        },
        jsr: {
          ref: "builtin:jsr",
          contractRef: "pubm.publish.package-registry/v1",
        },
      },
    },
    distributions: {
      assets: {
        compress: undefined,
        entries: [],
      },
    },
    closeout: {
      githubRelease: {
        ref: "builtin:github-release",
        contractRef: "pubm.closeout.release-surface/v1",
        mode: "draft",
        notes: {
          enabled: true,
        },
      },
    },
  },

  validation: {
    repository: {
      cleanInstall: true,
      entryPoints: true,
      extraneousFiles: true,
    },
    tests: true,
    build: true,
    dryRunPublish: true,
  },

  recovery: {
    policyRef: "builtin:recovery/individual",
    allowCompensation: false,
  },

  plugins: [],
});
```

This grouped authoring shape is a built-in convenience surface, not the extension contract. The loader may accept grouped target lanes for first-party UX, but normalization should lower them into open keyed target definitions before planner composition continues.

### Normalized loader output

The loader should normalize author input into a shape like:

```ts
type LoadedConfigV1 = {
  source: {
    configPath: string;
    cwd: string;
  };
  policy: ConfigPolicySnapshot;
  runtimePreferences: {
    locale?: "en" | "ko" | "zh-cn" | "fr" | "de" | "es";
    saveToken: boolean;
  };
  plugins: PluginSpec[];
  warnings: ConfigWarning[];
};
```

`ConfigPolicySnapshot` is the object used by composition to build `PlanRequest`.

The important rule is that `policy` contains only durable release policy, not incidental execution state.

## Field-By-Field Mapping

### Current top-level fields

| Current field | Canonical grouped path | Notes |
|---|---|---|
| `versioning` | `release.versioning.strategyRef` | Legacy values map to built-in refs such as `independent -> builtin:versioning/independent`. |
| `branch` | `workflow.branch` | Workflow routing policy. |
| `packages` | `packages.include` | Current array becomes the include list inside the package group. |
| `changelog` | `release.changelog.enabled` and `release.changelog.file` | `false` disables; string becomes explicit changelog file. |
| `changelogFormat` | `release.changelog.rendererRef` | Legacy values map to built-in refs such as `default -> builtin:changelog/default` and `github -> builtin:changelog/github`. |
| `commit` | `release.materialization.commit` | Materialization policy, not workflow selection. |
| `access` | `targets.registries.defaults.access` | Built-in registry-shorthand default publish policy; only applies where the resolved adapter supports it. |
| `fixed` | `release.versioning.groups.fixed` | Version graph policy. |
| `linked` | `release.versioning.groups.linked` | Version graph policy. |
| `updateInternalDependencies` | `release.versioning.updateInternalDependencies` | Belongs with version policy. |
| `ignore` | `packages.ignore` | Package discovery filter stays config-owned. |
| `validate.cleanInstall` | `validation.repository.cleanInstall` | Repository validation gate. |
| `validate.entryPoints` | `validation.repository.entryPoints` | Repository validation gate. |
| `validate.extraneousFiles` | `validation.repository.extraneousFiles` | Repository validation gate. |
| `snapshotTemplate` | `release.versioning.snapshotTemplate` | Snapshot naming policy. |
| `tag` | `targets.registries.defaults.tag` | Built-in registry-shorthand default publish tag, not git tag identity. |
| `contents` | `targets.registries.defaults.contents` | Built-in registry-shorthand provisional home; may later move under `Artifact` config once that slice settles. |
| `saveToken` | `runtimePreferences.saveToken` | Runtime preference only; excluded from `policy`. |
| `releaseDraft` | `targets.closeout.githubRelease.mode` | Built-in GitHub Release shorthand: `true -> "draft"`, `false -> "publish"` unless `releaseNotes` disables closeout. |
| `releaseNotes` | `targets.closeout.githubRelease.mode` and `targets.closeout.githubRelease.notes.enabled` | Built-in GitHub Release shorthand; `false` collapses to `mode = "off"` in compatibility mapping. |
| `createPr` | `workflow.ref` and `workflow.proposalRef` | Compatibility shorthand for `workflow.ref = "builtin:release-pr"` and default `workflow.proposalRef = "builtin:release-pr"`. |
| `rollbackStrategy` | `recovery.policyRef` | Legacy alias; values map to built-in refs such as `individual -> builtin:recovery/individual`. |
| `rollback.strategy` | `recovery.policyRef` | Canonical recovery binding should be ref-based, not a closed strategy enum. |
| `rollback.dangerouslyAllowUnpublish` | `recovery.allowCompensation` | Same intent, but renamed to match architecture vocabulary. |
| `lockfileSync` | `release.materialization.lockfileSync` | Version-write/materialization policy, not config loading. |
| `skipDryRun` | `validation.dryRunPublish = false` | Inverse compatibility alias. |
| `ecosystems` | `packages.ecosystems` | Ecosystem-scoped package defaults. |
| `plugins` | `plugins` | Still top-level; loaded before planner uses plugin-extended catalogs. |
| `compress` | `targets.distributions.assets.compress` | Built-in asset/distribution shorthand policy. |
| `releaseAssets` | `targets.distributions.assets.entries` | Built-in asset/distribution shorthand that feeds artifact/distribution planning from [pubm-self-hosting-pipeline-comparison](./2026-04-22-pubm-self-hosting-pipeline-comparison.md). |
| `excludeRelease` | `release.selection.excludeRelease` | Release-scope filter, not package discovery. |
| `locale` | `runtimePreferences.locale` | Runtime/UI preference only. |
| `versionSources` | `release.versioning.sourceRef` | Legacy values map to built-in refs such as `all -> builtin:version-source/all`. |
| `conventionalCommits.types` | `release.versioning.conventionalCommits.types` | Commit-source tuning remains part of version policy. |
| `registryQualifiedTags` | `release.versioning.registryQualifiedTags` | Direct rename from flat field to grouped version policy. |

### Current package entry fields

| Current field | Canonical grouped path | Notes |
|---|---|---|
| `packages[].path` | `packages.include[].path` | Direct carry-over. |
| `packages[].registries` | `packages.include[].targets.registries` | Package-level target selection references keyed target definitions, whether they came from built-in registry sugar or plugin-provided target categories. |
| `packages[].ecosystem` | `packages.include[].ecosystem` | Explicit ecosystem override remains package-local. |
| `packages[].testScript` | `packages.include[].scripts.test.script` | Package-local validation/build command policy should stop leaking as flat fields. |
| `packages[].testCommand` | `packages.include[].scripts.test.command` | Command form parallel to script form. |
| `packages[].buildScript` | `packages.include[].scripts.build.script` | Package-local build policy. |
| `packages[].buildCommand` | `packages.include[].scripts.build.command` | Command form parallel to script form. |

### Current ecosystem defaults

| Current field | Canonical grouped path | Notes |
|---|---|---|
| `ecosystems.<key>.testScript` | `packages.ecosystems.<key>.scripts.test.script` | Ecosystem-scoped default script. |
| `ecosystems.<key>.testCommand` | `packages.ecosystems.<key>.scripts.test.command` | Ecosystem-scoped command form. |
| `ecosystems.<key>.buildScript` | `packages.ecosystems.<key>.scripts.build.script` | Ecosystem-scoped build default. |
| `ecosystems.<key>.buildCommand` | `packages.ecosystems.<key>.scripts.build.command` | Ecosystem-scoped command form. |

## Target Normalization Rules

The public sketch in [external-interface-v1](./2026-04-22-external-interface-v1.md) shows `targets.registries` as an array shorthand.

For the normalized loader output, all target authoring forms should lower to one keyed target catalog:

- keyed targets give the planner stable target identifiers
- per-package target selection can reference target keys directly
- inline private registry descriptors can be lifted into canonical target definitions once, then referenced from packages
- plugin-defined target categories can plug in without needing the loader to grow a new enum case

Conceptually, normalization should produce entries shaped like:

```ts
type LoadedTargetDefinition = {
  targetKey: string;
  targetCategory: string;
  targetRef: string;
  contractRef?: string;
  capabilityKeys?: string[];
  config: Record<string, unknown>;
};
```

Built-in grouped lanes such as `registries`, `distributions`, and `closeout` are therefore authoring shorthands, not the canonical extension model.

That means the loader should accept both:

```ts
targets: { registries: ["npm", "jsr"] }
```

and:

```ts
targets: {
  registries: {
    defaults: {
      access: "public",
      tag: "latest",
    },
    definitions: {
      npm: {},
      jsr: {},
      internal: {
        url: "https://registry.example.com",
        token: { envVar: "INTERNAL_TOKEN" },
      },
    },
  },
}
```

but normalize to the keyed form before composition continues.

The important part of that normalization is not the exact object nesting. It is that planner input becomes key/ref based and open-ended, so a new plugin-defined target category does not require a loader-level target-kind enum expansion.

## Loader Responsibilities

The loader owns only config ingestion and normalization.

It should own:

- config file discovery (`pubm.config.*` and explicit `--config`)
- module evaluation and fallback loading strategy
- input-shape validation
- grouped-path normalization
- static defaulting of config policy values
- compatibility alias handling and deprecation warnings
- plugin declaration extraction
- target-definition normalization into open category/ref entries

It should not own:

- package discovery
- package graph construction
- current version resolution
- version choice synthesis
- credential hydration
- build/test execution
- dry-run publish execution
- mutable runtime/session flags

This is the main split from today's [`packages/core/src/config/defaults.ts`](/Users/classting/Workspace/temp/pubm/packages/core/src/config/defaults.ts:56), which currently mixes static defaults with discovery and resolved-package shaping.

## Planner Responsibilities

The planner owns everything that turns config policy plus repo state into a typed plan, consistent with [plan-slice-detailed-design](./2026-04-22-plan-slice-detailed-design.md).

Planner-owned work:

- discover release units from repo state plus `packages.include` / `packages.ignore`
- resolve package graph and versionable units
- expand package target selections into planned target contracts
- interpret version policy (`strategyRef`, `sourceRef`, fixed/linked groups, snapshot template)
- resolve validation evidence
- derive asset spec and target graph for `ReleasePlan`
- resolve secret-free credential/capability evidence where needed

The planner therefore replaces the current loader-time `ResolvedPackageConfig[]` materialization.

`loadConfig()` should stop pretending to answer questions that only the planner can answer.

## Runtime And Publish Responsibilities

Runtime/orchestration owns transient behavior only.

Runtime-owned work:

- merge CLI flags with `LoadedConfigV1`
- create the narrow `PlanRequest`
- prompt behavior and interactive secret collection
- locale/UI preference application
- secret persistence policy (`saveToken`)

Publish/runtime execution owns the boundary described in [publish-slice-detailed-design](./2026-04-22-publish-slice-detailed-design.md):

- rehydrate credentials
- revalidate volatile checks
- materialize artifacts
- execute publish/distribution/closeout targets
- persist execution state and recovery state

The config loader must never smuggle this state into `policy`.

## Compatibility And Deprecation Strategy

### Acceptance rule

For one migration window, the loader should accept:

- current flat `PubmConfig`
- new grouped config
- mixed configs

### Precedence rule

When both old and new forms are present:

1. grouped path wins
2. legacy field is ignored
3. loader emits one warning with the exact replacement path

This matches the current `rollbackStrategy -> rollback.strategy` behavior and should be generalized.

### Warning rule

Warnings should be structured and deduplicated per field:

- deprecated field name
- canonical replacement path
- whether a conflict occurred
- whether the value was auto-lifted

### Incremental migration order

1. Introduce `LoadedConfigV1` and canonical grouped normalization in the loader.
2. Keep a compatibility adapter that can still produce today's `ResolvedPubmConfig` for untouched call sites.
3. Move package discovery and resolved-package shaping out of config loading and into planner assembly.
4. Switch CLI/orchestration to `LoadedConfigV1 -> PlanRequest`, matching the Scope 7 direction from [low-level-migration-scope-plan](./2026-04-22-low-level-migration-scope-plan.md).
5. Update generated config writers and migration helpers to emit grouped config only.
6. Remove flat compatibility fields in the next major interface break.

## Unresolved Risks

### 1. Plugin registration order

[low-level-migration-scope-plan](./2026-04-22-low-level-migration-scope-plan.md) already notes that plugin-registered ecosystems and registries currently arrive too late.

That means loader validation order is not fully settled yet:

- validating `packages.include[].ecosystem` requires the plugin-extended ecosystem catalog
- validating built-in grouped target lanes may require plugin-provided target categories or target definitions

The likely answer is: load plugin declarations first, register their config/catalog extensions, then validate the rest of the config.

### 2. `contents` does not have a fully honest long-term home yet

Today `contents` behaves partly like publish-path policy and partly like an artifact/input-root shortcut.

Until the `Artifact` slice is stabilized, `targets.registries.defaults.contents` is only a provisional normalized path.

### 3. GitHub Release booleans are currently under-modeled

`releaseDraft` and `releaseNotes` are really one closeout policy split across two booleans.

The compatibility mapping in this doc is workable, but the final public surface should prefer only:

- a keyed closeout target definition such as `githubRelease`
- explicit `targetCategory` / `targetRef` modeling instead of boolean pairs that imply a closed target taxonomy

### 4. Per-package target shorthand needs stable synthesized keys

Current `packages[].registries` allows inline private registry descriptors.

The loader must synthesize deterministic target keys for those entries or require an explicit keyed target-definition form once grouped config is enabled broadly.

### 5. Config hashing must exclude runtime-only preferences

If plan identity or cache keys use config hashes later, `locale` and `saveToken` must not affect the policy hash.

They are runtime preferences, not release policy.

## Recommendation

Use a two-lane loader contract:

- `policy`: canonical grouped config used for `PlanRequest` composition
- `runtimePreferences`: non-domain config consumed only by orchestration/runtime

Then move package discovery out of config resolution entirely.

That gives pubm a config system that matches the 2026-04-22 architecture instead of continuing to treat config loading as an early planner/runtime hybrid.
