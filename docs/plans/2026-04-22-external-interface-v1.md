# External Interface V1

**Date:** 2026-04-22
**Status:** Draft

## Goal

Define a user-facing interface that:

- matches the new release-platform architecture
- keeps the default mental model simple
- does not leak too much internal state-machine complexity
- can grow into split CI and PR-based workflows
- can be compared directly against the current `pubm` surface

This model intentionally remains command-shaped:

- each user command maps to one composition request contract (`preflight`, `release`, `publish`, `snapshot`, `inspect`, `status`)
- there is no public generalized `session` or `command-intent` object
- no public API is forced through a single broad execution contract

## Design Principles

1. Keep the primary UX task-oriented, not engine-oriented.
2. Do not expose internal state-machine names by default.
3. Preserve a short path for the common case.
4. Move workflow policy out of ad-hoc flags and into explicit config.
5. Make machine-readable state first-class for CI and automation.

## Proposed Public Surface

### Primary Commands

```bash
pubm [version]
pubm preflight
pubm release [version]
pubm publish
pubm status
```

### Supporting Commands

```bash
pubm init
pubm inspect packages
pubm inspect targets
pubm inspect plan
pubm changes add
pubm changes status
pubm changes version
pubm changes changelog
pubm snapshot
pubm secrets sync
pubm migrate
pubm update
```

## Command Contracts and Composition

### `pubm [version]`

Default convenience contract.

Meaning:

- local one-shot release flow
- composition of the most common workflow
- should remain the fastest path for small projects

Conceptually:

```text
pubm [version] ~= pubm preflight [version]
             -> pubm release [version]
             -> pubm publish
```

Each public flow is composed of one explicit command contract and does not rely on a generic workflow session artifact.

Internal composition should stay bounded to small value objects: planning receives `PlanRequest`, release executes from `ReleaseInput`, publish runs from `PublishInput`, and inspection uses `InspectRequest`.
`ReleaseInput` is the release-slice contract from [release-slice-detailed-design](./2026-04-22-release-slice-detailed-design.md).

This should be a convenience command while keeping canonical workflows centered on explicit preflight/release/publish composition.

### `pubm preflight`

Creates or validates a release plan without materializing the release.

Responsibilities:

- branch / remote / working tree checks
- credential and target capability validation
- test and build validation
- version calculation preview
- changelog preview
- target resolution

Outputs:

- terminal summary
- optional machine-readable plan output

### `pubm release [version]`

Builds and materializes a release record according to workflow policy.

Examples:

- direct workflow: materialize release immediately
- PR workflow: create or update a release PR
- split CI workflow: create an immutable release record for later publish

This command should not require users to know internal execution phases.

### `pubm publish`

Consumes the current or selected release record and publishes to configured targets.

Responsibilities:

- package registries
- distribution targets
- target-level retry
- target-level status reporting

This command should not calculate versions.

### `pubm status`

Shows the current state of the latest or selected release workflow.

`status` is the canonical workflow-observability command. `inspect` remains plan/target/package introspection only.

Responsibilities:

- show current plan / proposal / release / publish status
- show failed targets and next actionable state
- expose machine-readable output for CI and automation

This becomes the main observability interface.

## Suggested CLI Shape

### Common UX

```bash
pubm
pubm preflight
pubm release
pubm publish
pubm status
```

### Common Flags

```bash
--json
--config <path>
--locale <locale>
--target <selector>
--package <selector>
```

### Workflow Flags

Keep this set intentionally small:

```bash
--workflow <one-shot|split-ci|release-pr>
--dry-run
--branch <name>
--any-branch
```

### Advanced Release Flags

These should exist, but be treated as advanced:

```bash
--proposal <none|release_pr|manual_approval>
--from <plan-id|release-record-id|tag>
--retry <failed|all>
--closeout-mode <auto|skip>
```

## Proposed Config Shape

The current config is useful but too flat.

A better public shape is:

```ts
export default defineConfig({
  workflow: {
    kind: "one-shot", // one-shot | split-ci | release-pr
    branch: "main",
    proposal: "release_pr", // none | release_pr | manual_approval
  },

  release: {
    versioning: {
      strategy: "independent", // independent | fixed
      source: "all", // all | changesets | commits | manual
      snapshotTemplate: "{tag}-{timestamp}",
      registryQualifiedTags: false,
    },
    changelog: {
      enabled: true,
      format: "default",
    },
  },

  packages: [
    { path: "." },
  ],

  targets: {
    registries: ["npm", "jsr"],
    distributions: [],
    closeout: {
      githubRelease: {
        mode: "draft", // off | draft | publish
      },
    },
  },

  validation: {
    tests: true,
    build: true,
    dryRunPublish: true,
  },

  recovery: {
    strategy: "individual",
    allowCompensation: false,
  },

  plugins: [],
});
```

### Why This Shape

- `workflow` captures execution strategy
- `release` captures versioning and changelog policy
- `targets` becomes the long-term home for registries, distributions, and closeout
- `validation` and `recovery` are explicit instead of scattered as skip flags

### Proposal Vocabulary (Canonical)

Use a single public proposal vocabulary across CLI/config and internal mapping:

- `none`: disable proposal flow.
- `release_pr`: generate or reuse PR/review workflow.
- `manual_approval`: require explicit human approval before release materialization.

Internal mapping:

- `release_pr` maps to `ReleaseProposal.kind` values `release_pr` or `preview_branch`.
- `manual_approval` maps to `ReleaseProposal.kind = "manual_approval"`.

## Suggested Machine-Readable Interface

This is currently weak and should become part of the public contract.

### `pubm preflight --json`

Returns a `ReleasePlan` summary:

```json
{
  "planId": "plan_123",
  "state": "planned",
  "packages": [],
  "targets": [],
  "versionPreview": [],
  "validation": {
    "ok": true
  }
}
```

### `pubm status --json`

Returns workflow state:

```json
{
  "planId": "plan_123",
  "proposalId": "prop_456",
  "releaseRecordId": "rel_789",
  "publishRunId": "run_999",
  "releaseState": "partially_materialized",
  "publishState": "partial",
  "closeoutState": "partial",
  "failedTargets": ["brew"],
  "nextAction": "publish_retry_failed"
}
```

The state fields in `status --json` map directly to typed internal contracts:

- `releaseState`: `ReleaseRecord.state` (`materializing` | `materialized` | `partially_materialized` | `failed_before_release` | `recovery_handoff` | `released`)
- `publishState`: `PublishRun.state` (`running` | `partial` | `published` | `failed` | `compensated`)
- `closeoutState`: `CloseoutRecord.state` (`closed` | `partial` | `failed`)
- `nextAction`: `NextAction` from [release-platform-architecture](./2026-04-22-release-platform-architecture.md) (`release`, `publish`, `publish_retry_failed`, `publish_retry_all`, `resume_recovery`, `none`)

This is more important than adding many new commands.

## Current Interface Vs Proposed Interface

### Command Model

| Area | Current | Proposed | Direction |
|---|---|---|---|
| Primary command | `pubm [version]` | `pubm [version]` as alias, but `preflight / release / publish / status` become canonical | Keep convenience, change center of gravity |
| Split execution | `--mode ci --phase prepare/publish` | `pubm preflight`, `pubm release`, `pubm publish` with workflow policy in config | Hide runner internals |
| Workflow style | `--create-pr` flag | `workflow.kind` + `proposal` policy | Make workflow explicit |
| GitHub Release control | `--release-draft`, `--skip-release` | `targets.closeout.githubRelease.mode=off|draft|publish` | Move product-specific behavior into targets |
| Retry / resume | not first-class | `pubm status`, `pubm publish --retry failed` | Make state and recovery visible |
| Machine-readable workflow state | limited | first-class `--json` on preflight/status/publish | Improve CI contract |

### Command Comparison

| Current command | Current meaning | Proposed command | Proposed meaning |
|---|---|---|---|
| `pubm [version]` | overloaded full pipeline | `pubm [version]` | convenience alias for common release+publish |
| `pubm --mode ci --phase prepare` | validate + dry-run publish + token handling | `pubm preflight` | create/validate release plan |
| `pubm --mode ci --phase publish` | publish from existing tag/version | `pubm publish` | publish from current release record |
| `pubm snapshot` | separate alternate pipeline | `pubm snapshot` | keep as explicit shorthand for snapshot policy |
| `pubm inspect packages` | package discovery introspection | `pubm inspect packages` | keep |
| none | no plan introspection | `pubm inspect plan` | inspect resolved release plan |
| `pubm changesets add/status/version/changelog` | changeset-specific namespace | `pubm changes add/status/version/changelog` | shorten and make domain-oriented |

### Config Comparison

| Current config surface | Problem | Proposed config surface | Benefit |
|---|---|---|---|
| `branch`, `createPr`, `releaseDraft`, `skipDryRun` are flat | workflow policy is scattered | `workflow`, `release`, `targets`, `validation`, `recovery` | clearer mental model |
| `versioning`, `versionSources`, `snapshotTemplate`, `registryQualifiedTags` are split | release policy is fragmented | `release.versioning.*` | group policy coherently |
| `packages[].registries` only | assumes registry-first worldview | `targets.registries`, `targets.distributions`, `targets.closeout` | future-proof target taxonomy |
| `releaseDraft` boolean controls GitHub Release existence | mixes release and closeout semantics | `targets.closeout.githubRelease.mode` | honest modeling |
| many skip flags and fallback behavior | operational behavior leaks into CLI | explicit workflow and validation policy | more stable interface |

## Interface Decisions

### Keep

- `pubm [version]` as the shortest path
- `init`, `inspect`, `migrate`, `secrets`, `update`
- `snapshot` as an explicit command
- a changes-focused namespace

### Change

- stop making `mode` and `phase` the primary public release interface
- stop making GitHub Release flags look like core release semantics
- stop treating PR-based release as a push fallback only
- introduce status as a first-class command

### Delay

Do not expose every internal state yet.

That means:

- no public `pubm plan` command for now
- no public `pubm propose` command for now
- no public `pubm closeout` command for now

Those may exist internally or as advanced interfaces later, but the first public redesign should stay narrow.

## Recommended V1 Public Contract

```bash
pubm [version]
pubm preflight
pubm release [version]
pubm publish
pubm status
pubm inspect packages
pubm inspect targets
pubm inspect plan
pubm changes add
pubm changes status
pubm changes version
pubm changes changelog
pubm snapshot
pubm init
pubm migrate
pubm secrets sync
pubm update
```

This keeps the public surface understandable while aligning with the new architecture.
