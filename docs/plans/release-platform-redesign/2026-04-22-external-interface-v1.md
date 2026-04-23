# External Interface V1

**Date:** 2026-04-22
**Status:** Draft

This draft follows [Architecture Evolution Principles](./2026-04-23-architecture-evolution-principles.md), especially the rule `closed core, open edge`.

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
2. Expose closed engine state only where the core truly owns lifecycle or next-action vocabulary.
3. Keep workflows, proposals, targets, policies, artifacts, and plugins open through refs, keys, and capabilities.
4. Preserve a short path for the common case.
5. Move workflow and target policy out of ad-hoc flags and into explicit config.
6. Make machine-readable state first-class for CI and automation.

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

Built-in flows such as one-shot, split CI, or release PR remain useful, but they should be selected as open refs such as `builtin:one-shot` or `builtin:release-pr`, not modeled as globally closed public kinds.

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
--target <key|pattern>
--package <selector>
```

### Workflow Flags

Keep this set intentionally small:

```bash
--workflow <ref>
--dry-run
--branch <name>
--any-branch
```

Built-in examples can be documented as `builtin:one-shot`, `builtin:split-ci`, or `builtin:release-pr`, but the public contract should accept a workflow ref rather than promise a closed enum.

### Advanced Release Flags

These should exist, but be treated as advanced:

```bash
--proposal <ref|none>
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
    ref: "builtin:release-pr",
    branch: "main",
    proposalRef: "builtin:release-pr",
  },

  release: {
    versioning: {
      strategyRef: "builtin:versioning/independent",
      sourceRef: "builtin:version-source/all",
      snapshotTemplate: "{tag}-{timestamp}",
      registryQualifiedTags: false,
    },
    changelog: {
      enabled: true,
      rendererRef: "builtin:changelog/default",
    },
    artifacts: {
      publishSpecRef: "builtin:package-archive",
    },
  },

  packages: [
    { path: "." },
  ],

  targets: {
    publish: [
      {
        key: "npm",
        ref: "builtin:npm",
        contractRef: "pubm.publish.package-registry/v1",
      },
      {
        key: "jsr",
        ref: "builtin:jsr",
        contractRef: "pubm.publish.package-registry/v1",
      },
      {
        key: "brew-core",
        ref: "plugin:brew/homebrew-core",
        contractRef: "pubm.publish.catalog-update/v1",
        capabilityKeys: ["consumes-release-assets", "scm-review-flow"],
      },
    ],
    closeout: [
      {
        key: "github-release",
        ref: "builtin:github-release",
        contractRef: "pubm.closeout.release-surface/v1",
        mode: "draft", // off | draft | publish
      },
    ],
  },

  validation: {
    policyRefs: [
      "builtin:validation/tests",
      "builtin:validation/build",
    ],
    dryRunPublish: true,
  },

  recovery: {
    policyRef: "builtin:recovery/individual",
    allowCompensation: false,
  },

  plugins: [
    {
      key: "brew",
      ref: "@pubm/plugin-brew",
      contractRef: "pubm.plugin.publish-target-factory/v1",
      capabilityKeys: ["publish-target-factory"],
    },
  ],
});
```

### Why This Shape

- `workflow.ref` selects execution strategy without forcing a public `WorkflowKind`
- `workflow.proposalRef`, `release.versioning.strategyRef`, `release.versioning.sourceRef`, `release.changelog.rendererRef`, and `release.artifacts.publishSpecRef` keep workflow, policy, and artifact selection open
- config uses nested paths such as `workflow.ref` and `workflow.proposalRef`, while machine-readable output flattens them to `workflowRef` and `proposalRef`
- `targets.publish[]` and `targets.closeout[]` distinguish engine lanes without introducing a global target-kind enum
- `plugins[]` stays open through `key`, `ref`, `contractRef`, and `capabilityKeys`
- `validation` and `recovery` are explicit instead of scattered as skip flags

### Proposal References

Use `workflow.proposalRef` in config and `proposalRef` in machine-readable output and CLI-facing terminology.

- `none` means no proposal binding is selected; it is absence, not a proposal kind.
- built-in refs can include values such as `builtin:release-pr` or `builtin:manual-approval`
- plugins can contribute additional proposal refs later without changing the core contract

Internal mapping is intentionally flexible. A public `proposalRef` may resolve to one or more internal handlers, and the external interface should not promise a 1:1 mapping to an internal enum.

## Suggested Machine-Readable Interface

This is currently weak and should become part of the public contract.

### `pubm preflight --json`

Returns a `ReleasePlan` summary:

```json
{
  "planId": "plan_123",
  "workflowRef": "builtin:release-pr",
  "state": "planned",
  "packages": [],
  "targets": [
    {
      "targetKey": "npm",
      "targetRef": "builtin:npm",
      "contractRef": "pubm.publish.package-registry/v1"
    }
  ],
  "versionPreview": [],
  "policyBindings": [
    {
      "slotKey": "versioning",
      "policyRef": "builtin:versioning/independent"
    }
  ],
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
  "workflowRef": "builtin:release-pr",
  "proposalId": "prop_456",
  "proposalRef": "builtin:release-pr",
  "releaseRecordId": "rel_789",
  "publishRunId": "run_999",
  "releaseState": "partially_materialized",
  "publishState": "partial",
  "closeoutState": "partial",
  "failedTargets": ["brew-core"],
  "nextAction": "publish_retry_failed"
}
```

The closed state fields in `status --json` map directly to typed internal contracts:

- `releaseState`: `ReleaseRecord.state` (`materializing` | `materialized` | `partially_materialized` | `failed_before_release` | `recovery_handoff` | `released`)
- `publishState`: `PublishRun.state` (`running` | `partial` | `published` | `failed` | `compensated`)
- `closeoutState`: `CloseoutRecord.state` (`closed` | `partial` | `failed`)
- `nextAction`: `NextAction` from [release-platform-architecture](./2026-04-22-release-platform-architecture.md) (`release`, `publish`, `publish_retry_failed`, `publish_retry_all`, `resume_recovery`, `none`)

`workflowRef`, `proposalRef`, target keys, policy refs, and plugin refs remain intentionally open strings. Only lifecycle state and next-action vocabulary are closed.

This is more important than adding many new commands.

## Current Interface Vs Proposed Interface

### Command Model

| Area | Current | Proposed | Direction |
|---|---|---|---|
| Primary command | `pubm [version]` | `pubm [version]` as alias, but `preflight / release / publish / status` become canonical | Keep convenience, change center of gravity |
| Split execution | `--mode ci --phase prepare/publish` | `pubm preflight`, `pubm release`, `pubm publish` with workflow policy in config | Hide runner internals |
| Workflow style | `--create-pr` flag | `workflow.ref` + `workflow.proposalRef` | Make workflow explicit without closing the vocabulary |
| GitHub Release control | `--release-draft`, `--skip-release` | `targets.closeout[*].{ref,contractRef,mode}` | Move product-specific behavior into closeout target contracts |
| Retry / resume | not first-class | `pubm status`, `pubm publish --retry failed` | Make state and recovery visible |
| Machine-readable workflow state | limited | first-class `--json` on preflight/status/publish with open refs plus closed states | Improve CI contract |

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
| `branch`, `createPr`, `releaseDraft`, `skipDryRun` are flat | workflow policy is scattered | `workflow.ref`, `workflow.proposalRef`, `targets`, `validation`, `recovery` | clearer mental model without `*Kind` enums |
| `versioning`, `versionSources`, `snapshotTemplate`, `registryQualifiedTags` are split | release policy is fragmented | `release.versioning.strategyRef`, `release.versioning.sourceRef`, `release.changelog.rendererRef`, `release.artifacts.publishSpecRef` | group policy while keeping policy and artifact axes open |
| `packages[].registries` only | assumes registry-first worldview | `targets.publish[].{key,ref,contractRef}` and `targets.closeout[]` | future-proof target modeling |
| `releaseDraft` boolean controls GitHub Release existence | mixes release and closeout semantics | closeout target entry with `ref`, `contractRef`, and `mode` | honest modeling |
| plugins trend toward ad-hoc wiring | future plugin taxonomy gets over-closed fast | `plugins[].{key,ref,contractRef,capabilityKeys}` | plugin boundary stays open |
| many skip flags and fallback behavior | operational behavior leaks into CLI | explicit workflow and validation policy refs | more stable interface |

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
- stop introducing public `*Kind` vocabulary for extension axes the core does not own
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
