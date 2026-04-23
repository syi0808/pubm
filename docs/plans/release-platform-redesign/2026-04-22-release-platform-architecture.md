# Release Platform Architecture

**Date:** 2026-04-22
**Status:** Draft

This draft follows [Architecture Evolution Principles](./2026-04-23-architecture-evolution-principles.md), especially the rule `closed core, open edge`.

## Goal

Redesign `pubm` from a single publish pipeline into a release platform that can:

- preserve a simple `preflight / release / publish` UX
- support deeper internal workflow states
- cover one-shot local flows and split CI flows
- model PR-based workflows such as `release-please`
- keep extensibility without collapsing into a pile of unrelated features

## Architecture Boundary

This architecture uses these hard rules:

- core domain slices exchange **typed artifacts** (for example `ReleasePlan`, `ProposalRecord`, `ReleaseRecord`, `PublishRun`, `CloseoutRecord`).
- commands, workflow presets, and CLI entrypoints are composition only; they create orchestration envelopes and dispatch.
- composition boundaries use narrow slice-specific request contracts, not one large monolithic orchestration object.
- any shared `session` concept is runtime/orchestration-only and must remain out of domain contracts.
- engine-owned lifecycle state and next-action vocabularies may stay closed.
- workflow, proposal, target, policy, artifact, and plugin variation must stay open via `key` / `ref` / `capability` / `contract` patterns.

```ts
type PlanRequest =
  | { command: "preflight"; input: PreflightPlanRequest }
  | { command: "snapshot"; input: SnapshotPlanRequest };
```

`PreflightPlanRequest` and `SnapshotPlanRequest` are defined in
[plan-slice-detailed-design](./2026-04-22-plan-slice-detailed-design.md)
and represent planning-entry contracts.
`pubm release` may compose a planning step first, but the stable release-slice handoff remains `ReleaseInput`, not a `PlanRequest` release variant.
`PublishInput` and `InspectRequest` are separate publish and inspect slice contracts.
`ReleaseInput` is the release-slice contract and is defined in
[release-slice-detailed-design](./2026-04-22-release-slice-detailed-design.md).

Each request shape is narrow and carries only command-relevant intent. Domain engines consume typed inputs (`PlanRequest`, `ReleaseInput`, `PublishInput`, `InspectRequest`) from orchestration, not shared session-style state.

## Closed Core, Open Edge

Per [Architecture Evolution Principles](./2026-04-23-architecture-evolution-principles.md):

- closed core: engine-owned lifecycle state, transition state, and machine next-action vocabulary
- open edge: workflow presets, proposal mechanisms, target definitions, policy bindings, artifact contracts, and plugin integrations
- test: if adding a new external provider would require extending a core enum, that axis is over-closed
- default edge shape: use `*Key` for resolved identities, `*Ref` for selected presets or implementations, `contractRef` for behavior, and `capabilityKeys` for optional features

## Core View

The user-facing model can stay simple:

- `preflight`
- `release`
- `publish`

Built-in workflows such as one-shot, split CI, or PR-oriented release should be modeled as selectable refs at the edge, not as engine-owned enums in the domain core.

But the internal core needs a richer state machine:

- `Plan`
- `Propose`
- `Release`
- `Publish`
- `Closeout`

`Recovery` is cross-cutting and can resume or compensate from failed states.

## Architecture

```mermaid
flowchart TB
  subgraph UX["User-Facing UX"]
    U1["pubm preflight"]
    U2["pubm release"]
    U3["pubm publish"]
  end

  subgraph Pipelines["Built-in Workflow Presets"]
    P1["builtin:one-shot"]
    P2["builtin:split-ci"]
    P3["builtin:release-pr"]
    P4["builtin:snapshot"]
  end

  subgraph Compose["Composition / Orchestration"]
    CMD["Dispatcher"]
    WF["WorkflowRef"]
    ENV["PlanRequest"]
    PUBREQ["PublishInput"]
    INREQ["InspectRequest"]
    POL["PolicyBindings (ref + digest)"]
    PLUG["PluginBindings"]
    CTX["RuntimeContext (non-domain)"]
  end

  subgraph Policies["Resolved Policy Contracts"]
    V["version policy ref"]
    PP["proposal policy ref"]
    TP["topology policy ref"]
    PB["publish policy ref"]
    CP["closeout policy ref"]
    RP["recovery policy ref"]
  end

  subgraph Core["State-Machine Core"]
    PLAN["Planner"]
    PROP["ProposalEngine"]
    REL["ReleaseEngine"]
    DIST["PublishEngine"]
    CLOSE["CloseoutEngine"]
    RECON["RecoveryEngine"]
    STORE[("State Store")]
  end

  subgraph Contracts["Typed Contracts"]
    ARP["ReleasePlan"]
    APR["ProposalRecord"]
    ARR["ReleaseRecord"]
    APRUN["PublishRun"]
    ACO["CloseoutRecord"]
  end

  subgraph Adapters["Adapters / Integrations"]
    S1["Changesets / Commits / Manual input"]
    S2["GitHub / Git / PR systems"]
    T1["npm / jsr / crates / private registry"]
    O1["GitHub Release / Assets / Notifications / Deploy"]
  end

  U1 --> CMD
  U2 --> CMD
  U3 --> CMD
  P1 --> CMD
  P2 --> CMD
  P3 --> CMD
  P4 --> CMD
  WF --> CMD
  V --> POL
  PP --> POL
  TP --> POL
  PB --> POL
  CP --> POL
  RP --> POL
  POL --> CMD
  PLUG --> CMD
  S1 --> CMD
  S2 --> CMD
  DIST --> T1
  CLOSE --> O1

  CMD --> ENV
  CMD --> PUBREQ
  CMD --> INREQ
  CMD --> CTX
  ENV --> PLAN
  PLAN --> PROP
  PLAN --> REL
  PUBREQ --> DIST

  PLAN --> ARP
  ARP --> PROP
  ARP --> REL
  PROP --> APR
  REL --> ARR
  ARR --> DIST
  ARR --> CLOSE
  DIST --> APRUN
  APRUN --> ACO
  ARR --> RECON
  RECON --> APRUN
  CLOSE --> ACO
  
  PLAN --> STORE
  PROP --> STORE
  REL --> STORE
  DIST --> STORE
  CLOSE --> STORE
  RECON --> STORE
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> Planned: plan created

  Planned --> Proposed: proposal required
  Planned --> Materializing: direct release

  Proposed --> Proposed: update / reconcile
  Proposed --> Materializing: approved / merged
  Proposed --> [*]: rejected

  Materializing --> Materialized: all source mutations + tags created
  Materializing --> PartiallyMaterialized: mutation + commit partially persisted
  Materializing --> FailedBeforeRelease: unrecoverable materialization failure
  Materializing --> RecoveryHandoff: checkpoint for reconciliation

  Materialized --> Publishing: start publish

  Publishing --> PartiallyPublished: some targets failed
  Publishing --> Published: required targets succeeded
  Publishing --> RecoveryHandoff: unrecoverable publish failure

  PartiallyPublished --> Publishing: retry failed targets
  PartiallyPublished --> RecoveryHandoff: reconciliation handoff

  Published --> Closing: start closeout

  Closing --> Closed: closeout completed
  Closing --> RecoveryHandoff: closeout failed

  RecoveryHandoff --> Recovery
  Recovery --> Materializing: resume materialization
  Recovery --> Publishing: resume publish
  Recovery --> Closing: resume closeout
  Recovery --> [*]: abandoned

  Closed --> [*]
```

The release half of this state machine maps to `ReleaseRecordState`:

- `Materializing` -> `materializing`
- `Materialized` -> `materialized`
- `PartiallyMaterialized` -> `partially_materialized`
- `FailedBeforeRelease` -> `failed_before_release`
- `RecoveryHandoff` -> `recovery_handoff`

## Domain Objects

```ts
type ReleaseRecordState =
  | "materializing"
  | "materialized"
  | "partially_materialized"
  | "failed_before_release"
  | "recovery_handoff"
  | "released";

type ProposalRecordState =
  | "open"
  | "updated"
  | "approved"
  | "rejected"
  | "merged";

type PublishRunState =
  | "running"
  | "partial"
  | "published"
  | "failed"
  | "compensated";

type CloseoutRecordState = "closed" | "partial" | "failed";

type NextAction =
  | "release"
  | "publish"
  | "publish_retry_failed"
  | "publish_retry_all"
  | "resume_recovery"
  | "none";

type WorkflowBinding = {
  workflowRef: string;
  contractRef: string;
  capabilityKeys: string[];
};

type PolicyBinding = {
  slotKey: string;
  policyRef: string;
  contractRef: string;
  capabilityKeys: string[];
  digest: string;
};

type PluginBinding = {
  pluginKey: string;
  pluginRef: string;
  contractRef: string;
  capabilityKeys: string[];
};

type ReleasePlan = {
  id: string;
  commitSha: string;
  configHash: string;
  workflow: WorkflowBinding;
  units: ReleaseUnit[];
  targets: TargetSelection[];
  versionDecisions: VersionDecision[];
  changelogPreview: ChangelogPreview[];
  validation: ValidationEvidence;
  policyBindings: PolicyBinding[];
  plugins: PluginBinding[];
  policyDigest: string;
};

type ProposalRecord = {
  id: string;
  planId: string;
  proposalRef: string;
  contractRef: string;
  adapterKey: string;
  capabilityKeys: string[];
  state: ProposalRecordState;
  reviewUrl?: string;
};

type ResolvedPublishTarget = {
  unitKey: string;
  packagePath: string;
  targetKey: string;
  targetRef: string;
  contractRef: string;
  adapterKey: string;
  capabilityKeys: string[];
  orderGroup: string;
  orderIndex: number;
  artifactContractRef: string;
  artifactRef: string;
  artifactSpecRef: string;
  requiredForCloseout: boolean;
  requiredForProgress: boolean;
  closeoutDependencyKey?: string;
};

type ResolvedCloseoutTarget = {
  unitKey: string;
  targetKey: string;
  targetRef: string;
  contractRef: string;
  adapterKey: string;
  capabilityKeys: string[];
  enabled: boolean;
  requiredForCloseout?: boolean;
};

type ReleaseRecord = {
  id: string;
  planId: string;
  proposalId?: string;
  releaseSha: string;
  branch: string;
  tags: string[];
  manifestDigest: string;
  changelogDigest: string;
  policyDigest: string;
  mutationDigest: string;
  unitVersions: {
    unitKey: string;
    version: string;
  }[];
  publishTargets: ResolvedPublishTarget[];
  closeoutTargets: ResolvedCloseoutTarget[];
  createdAt: string;
  state: ReleaseRecordState;
};

type PublishRun = {
  id: string;
  releaseRecordId: string;
  targetStates: TargetState[];
  state: PublishRunState;
};

type CloseoutRecord = {
  id: string;
  releaseRecordId: string;
  state: CloseoutRecordState;
};

`releaseRecordId` fields in `PublishRun` and `CloseoutRecord` are explicit foreign keys to `ReleaseRecord.id`.

type ValidationEvidence = {
  repositoryReadiness: RepositoryReadinessEvidence;
  credentialResolution: CredentialResolutionEvidence[];
  capabilityEvidence: CapabilityEvidence[];
  stableConditions: StableConditionEvidence[];
  volatileTargetReadiness: VolatileTargetReadinessEvidence[];
  qualityGates: QualityGateEvidence[];
};

type RepositoryReadinessEvidence = {
  validatorKey: string;
  contractRef: string;
  branchPolicySatisfied: boolean;
  remotePolicySatisfied: boolean;
  workingTreeSatisfied: boolean;
  observedAt: string;
};

type CredentialResolutionEvidence = {
  targetKey: string;
  mechanismKey: string;
  capabilityKeys: string[];
  resolvedAt: string;
};

type CapabilityEvidence = {
  subjectKey: string;
  contractRef: string;
  capabilityKeys: string[];
  observedAt: string;
};

type StableConditionEvidence = {
  conditionKey: string;
  contractRef?: string;
  satisfied: boolean;
};

type VolatileTargetReadinessEvidence = {
  targetKey: string;
  checkKey: string;
  contractRef?: string;
  observedAt: string;
  mustRevalidateAtPublish: true;
};

type QualityGateEvidence = {
  gateKey: string;
  contractRef?: string;
  status: "passed" | "failed" | "skipped";
  observedAt: string;
};
```

`ReleaseRecordState`, `ProposalRecordState`, `PublishRunState`, `CloseoutRecordState`, and `NextAction` are intentionally closed because the engine owns those transitions.
Workflow, proposal, target, policy, artifact, and plugin variation stays open through `*Key`, `*Ref`, `contractRef`, and `capabilityKeys`.

`ValidationEvidence` is evidence, not material. `ReleasePlan` can record that credentials were resolved and what capabilities were observed, but it must never persist secrets, raw tokens, or other credential material.

This makes each core step an explicit artifact handoff instead of shared mutable context:

- `Plan` accepts a narrow `PlanRequest` from orchestration and outputs a `ReleasePlan`.
- `Release` consumes `ReleasePlan` and outputs a `ReleaseRecord`.
- `Publish` consumes `ReleaseRecord` and outputs `PublishRun`.
- `Closeout` consumes `PublishRun` and outputs `CloseoutRecord`.

## Ecosystem And Registry

`Ecosystem` and `Registry` should both remain, but not as pipeline phases.

They are adapter boundaries at the edge. The core should reference them through keys, refs, and contracts, not through expanding `EcosystemKind` or `RegistryKind` enums.

They should become separate adapter axes:

- `Ecosystem` = source-side packaging and workspace semantics
- `Registry` = package distribution target

They solve different problems and should not be merged.

### Keep `Ecosystem`

`Ecosystem` owns package semantics:

- manifest discovery
- workspace and package graph discovery
- package identity
- version read/write rules
- workspace protocol resolution
- build / pack semantics
- artifact production inputs

Examples:

- JavaScript ecosystem
- Rust ecosystem
- future ecosystems

### Keep `Registry`

`Registry` owns package publication semantics:

- auth and capability checks
- package existence / availability checks
- dry-run capability
- publish
- already-published detection
- channel / dist-tag support
- compensation support such as unpublish or yank when possible

Examples:

- npm
- jsr
- crates.io
- private package registries

### Add Separate Concepts For Non-Registry Targets

Do not overload `Registry` with everything.

Keep these separate:

- `ProposalTarget` or `SCMAdapter`
  - GitHub PR
  - Git provider operations
- `CloseoutTarget`
  - GitHub Release
  - release assets
  - notifications
  - deployment triggers

If `Registry` starts owning PRs, GitHub Releases, Homebrew tap updates, and notifications, it will become meaningless.

## How Ecosystem And Registry Bind To The New Core

```mermaid
flowchart LR
  subgraph Source["Source Side"]
    REPO["Repository"]
    ECO["EcosystemAdapter"]
    UNIT["ReleaseUnit"]
  end

  subgraph ReleaseCore["Core"]
    PLAN["ReleasePlan"]
    REC["ReleaseRecord"]
    RUN["PublishRun"]
  end

  subgraph Targets["Target Side"]
    REG["RegistryAdapter"]
    CLO["CloseoutTarget"]
  end

  REPO --> ECO
  ECO --> UNIT
  UNIT --> PLAN
  PLAN --> REC
  REC --> RUN
  UNIT --> REG
  REG --> RUN
  REC --> CLO
```

## Ecosystem + Registry Composition

```mermaid
flowchart TB
  subgraph Source["Source Modeling"]
    REPO["Repository"]
    ECO["EcosystemAdapter"]
    UNIT["ReleaseUnit"]
    ART["ArtifactSpec"]
  end

  subgraph Core["Core State"]
    PLAN["ReleasePlan"]
    REC["ReleaseRecord"]
    RUN["PublishRun"]
  end

  subgraph PackagePublish["Package Publishing"]
    REG["RegistryAdapter"]
    PT["PublishTarget"]
  end

  subgraph Distribution["Other Distribution / Closeout"]
    SCM["SCMAdapter"]
    DIST["DistributionTarget"]
    CLO["CloseoutTarget"]
  end

  REPO --> ECO
  ECO --> UNIT
  ECO --> ART
  UNIT --> PLAN
  ART --> PLAN

  PLAN --> REC
  REC --> RUN

  UNIT --> PT
  PT --> REG
  REG --> RUN

  REC --> DIST
  REC --> CLO
  SCM --> DIST
```

### Interpretation

- `EcosystemAdapter` describes what a releasable unit is and how artifacts are derived.
- `RegistryAdapter` publishes package units to package registries.
- `DistributionTarget` handles non-registry distribution channels that may depend on assets, SCM flows, or catalog updates.
- `CloseoutTarget` handles public announcement and post-publish bookkeeping.

This keeps `Ecosystem` and `Registry` meaningful while leaving room for non-registry targets.

### Binding Model

The key relation is:

- one `ReleaseUnit` belongs to one `Ecosystem`
- one `ReleaseUnit` can publish to many `Registry` targets
- one `ReleaseRecord` can feed many `CloseoutTarget`s

That implies a structure like:

```ts
type ReleaseUnit = {
  key: string;
  ecosystemKey: string;
  ecosystemRef: string;
  packagePath: string;
  packageName: string;
};

type PublishTargetBinding = {
  unitKey: string;
  targetKey: string;
  targetRef: string;
  contractRef: string;
  capabilityKeys: string[];
};

type CloseoutTargetBinding = {
  targetKey: string;
  targetRef: string;
  contractRef: string;
  capabilityKeys: string[];
};
```

## Engine Responsibilities

### Planner

Inputs:

- one normalized `PlanRequest` from orchestration (`PreflightPlanRequest`, `SnapshotPlanRequest`)
- resolved workflow, policy, and plugin bindings from composition
- `Ecosystem` to discover packages, graphs, manifests, and versionable units
- `Registry` to resolve credentials into non-secret evidence, gather capability evidence, and precheck target readiness
- `RepositoryReadinessValidator` and quality gates to validate repository state, tests, and build validation

Produces:

- `ReleasePlan` with immutable validation evidence

### ProposalEngine

Inputs:

- `ReleasePlan`
- `SCMAdapter`

Produces:

- `ProposalRecord`

### ReleaseEngine

Inputs:

- `ReleasePlan`
- optional `ProposalRecord`
- `Ecosystem` to materialize manifests and version changes
- `SCMAdapter` to commit, tag, merge, or create release records

Produces:

- `ReleaseRecord`

### PublishEngine

Inputs:

- `ReleaseRecord`
- `PublishInput` (run selection + retry/closeout mode)
- resolved target contracts and capability metadata (via `targetRef`, `contractRef`, and `adapterKey`)
- `Ecosystem` to build or pack publishable artifacts
- `Registry` to publish each unit/target pair

Produces:

- `PublishRun`

### CloseoutEngine

Inputs:

- `PublishRun`
- `ReleaseRecord`
- resolved closeout target contracts

Produces:

- `CloseoutRecord`

## Brew Classification

### Short Position

`Brew` can be modeled as a first-class publish target, but it should probably not be modeled as a `Registry`.

The better long-term fit is:

- `RegistryAdapter` for package registries such as npm, jsr, crates, private registries
- `DistributionTarget` for channels such as Homebrew tap/core, winget manifests, scoop buckets, apt repo metadata, Docker image promotion, or CDN/catalog updates

### Why Not Call Brew A Registry?

Because the abstraction boundary becomes less truthful.

Homebrew publishing, especially the current `plugin-brew` implementation, is not primarily:

- uploading a package to a registry API
- checking whether a semver already exists in a package namespace
- publishing directly from an ecosystem manifest

It is primarily:

- consuming release assets
- generating or updating a formula
- cloning or modifying another repository
- pushing a branch or opening a PR
- depending on SCM access and review workflow

Those are distribution-catalog operations, not package-registry operations.

### Why It Is Still Tempting To Treat Brew Like A Registry

Because at the workflow level, it behaves like a publish target:

- it is part of the release distribution surface
- it has credentials and preflight checks
- it can succeed or fail independently
- it needs retry, compensation, and status tracking
- users may want to say "publish to npm + jsr + brew"

That instinct is valid.

The mistake is not making Brew first-class.
The mistake is making `Registry` the name of that first-class abstraction.

### Recommended Direction

If pubm wants a broader platform abstraction, distinguish publish execution from closeout execution in the core, but keep target taxonomy open:

Then model targets like this:

```ts
type PublishTarget = {
  targetKey: string;
  targetRef: string;
  contractRef: string;
  capabilityKeys: string[];
};

type CloseoutTarget = {
  targetKey: string;
  targetRef: string;
  contractRef: string;
  capabilityKeys: string[];
};
```

In that model:

- `npm` can implement `pubm.publish.package-registry/v1`
- `brewTap` or `brewCore` can implement `pubm.publish.catalog-update/v1`
- GitHub Release can implement `pubm.closeout.release-surface/v1`

The engine routes by contract and observed capability, not by a globally closed target-kind enum.

### Philosophy Fit

For `pubm`'s direction, the cleaner philosophy is:

- do not force every outward release action into `Registry`
- do make every outward release action a first-class target with state, policy, and retry semantics

That preserves the product story:

- `pubm` releases software to many channels
- some channels are registries
- some channels are installer catalogs
- some channels are announce/closeout surfaces

This is more future-proof than teaching users that "Homebrew is a registry" when the actual mechanics are PRs, formula repos, and release assets.

## Current Feature Mapping

| Current concern | New home |
|---|---|
| `preflight credentials` | Planner `Credential Resolution` + `Capability Evidence` |
| `prerequisites` | Planner `RepositoryReadinessValidator` |
| `required conditions` (stable) | Planner stable-condition validators |
| `required conditions` (volatile) | Planner precheck + Publish revalidation |
| `test` | Planner quality gate |
| `build` (validation) | Planner quality gate |
| `build` (artifact materialization) | PublishEngine via `Ecosystem` |
| changesets / commit analysis | VersionPolicy inside Planner |
| changelog preview | Planner |
| manifest version bump | ReleaseEngine via Ecosystem |
| changelog write | ReleaseEngine |
| commit / tag | ReleaseEngine via SCMAdapter |
| release PR | ProposalEngine |
| npm / jsr / crates publish | PublishEngine via Registry |
| GitHub Release / release assets | CloseoutEngine |
| rollback / retry / compensation | RecoveryEngine |

## Prepare/Check Task Remapping

The current `prepare` and `check` surface mixes repository facts, external target facts, and quality gates into a single bundle. The new architecture should separate those concerns so split-CI handoff is explicit instead of implicit.

```mermaid
flowchart LR
  subgraph Current["Current prepare/check tasks"]
    CRED["preflight credentials"]
    PRE["prerequisites"]
    COND["required conditions"]
    TEST["test"]
    BUILD["build"]
  end

  subgraph Plan["Plan stage"]
    CR["Credential Resolution"]
    CE["Capability Evidence"]
    RR["RepositoryReadinessValidator"]
    STABLE["StableConditionValidator"]
    VOL["VolatileTargetReadinessPrecheck"]
    Q1["QualityGate: test"]
    Q2["QualityGate: build validation"]
    PLAN["ReleasePlan
validation evidence only
no secrets"]
  end

  REL["ReleaseRecord"]

  subgraph Publish["Publish stage"]
    RV["Revalidate volatile target readiness"]
    AM["Artifact materialization"]
  end

  CRED --> CR --> CE --> PLAN
  PRE --> RR --> PLAN
  COND --> STABLE --> PLAN
  COND --> VOL --> PLAN
  TEST --> Q1 --> PLAN
  BUILD --> Q2 --> PLAN
  PLAN --> REL
  REL --> RV
  REL --> AM
```

### Mapping Rules

- `preflight credentials` should become two planner outputs:
  - `Credential Resolution`: prove that the configured mechanism can resolve usable credentials for each target.
  - `Capability Evidence`: prove what those resolved credentials are allowed to do.
- Invariant: `ReleasePlan` never stores secrets, tokens, or raw credential material. It stores only non-secret evidence such as mechanism, target, observed capability summary, timestamps, and pass/fail results.

- `prerequisites` should become `RepositoryReadinessValidator` in `Plan`.
  - This is where branch policy, remote policy, working tree cleanliness, and commit anchoring live.
  - These checks are stable relative to `commitSha` and `configHash`, so they belong in `ReleasePlan` evidence.

- `required conditions` should split into two categories:
  - Stable conditions: conditions whose truth is anchored by the planned repository state and policy snapshot. These live in `Plan`.
  - Volatile target readiness: conditions that can change between planning and publish, such as registry reachability, version availability, mutable permission state, or target openness.
  - Volatile checks should still be prechecked in `Plan` to fail fast, but they must be revalidated in `Publish` before external side effects.

- `test` is a `Plan` quality gate.
  - It answers whether the release candidate is acceptable, not whether an external target is currently ready.

- `build` must split into two different responsibilities:
  - `build validation` in `Plan`: prove that the release input can build and that the expected artifact spec is satisfiable.
  - `artifact materialization` in `Publish`: produce the actual artifacts that will be uploaded or attached.
  - `Publish` can verify that materialized artifacts still match the planned artifact spec, but it should not treat artifact creation as a substitute for the earlier build quality gate.

### Split-CI Timing Consequence

In split CI, the handoff is not "prepare already did everything." The timing must be:

1. `Plan` runs repository readiness validation, credential resolution, capability evidence gathering, stable-condition validation, volatile prechecks, tests, and build validation.
2. `Release` freezes the source mutation set and emits the `ReleaseRecord`.
3. `Publish` rehydrates fresh credentials, revalidates volatile target readiness, materializes artifacts, and then performs external side effects.

This timing distinction is why stable conditions belong in `ReleasePlan`, while volatile readiness must be checked twice: once to fail fast during planning and once to prove the target is still publishable at execution time.

## Representative Workflows

### One-Shot Local

```text
Plan -> Release -> Publish -> Closeout
```

### Split CI

```text
Plan -> Release
              -> Publish -> Closeout
```

### PR-Based Release (`release-please` style)

```text
Plan -> Propose -> Release -> Publish -> Closeout
```

### Snapshot / Canary

```text
Plan(snapshot policy) -> Release(ephemeral or lightweight) -> Publish -> Closeout(optional)
```

## Design Invariants

- `ReleasePlan` is immutable and replayable.
- `ReleasePlan` never stores secrets; it stores only non-secret readiness and capability evidence.
- `ProposalRecord` is reviewable and updateable.
- `ReleaseRecord` is the source of truth for a release.
- Only engine-owned lifecycle and next-action vocabularies are closed.
- Workflow, proposal, target, policy, artifact, and plugin modeling stay open through refs, contracts, and capabilities.
- Stable conditions can be trusted from `Plan` when they are anchored to the planned repository state and policy snapshot.
- Volatile target readiness must be prechecked in `Plan` and revalidated in `Publish`.
- `PublishRun` tracks state per target, not just globally.
- `build validation` and `artifact materialization` are separate responsibilities.
- `Closeout` must depend on publish outcomes, not run independently.
- `Ecosystem` is not a target concept.
- `Registry` is not a proposal or closeout concept.

## Recommendation

Keep `Ecosystem` and `Registry`, but narrow their meanings. Apply [Architecture Evolution Principles](./2026-04-23-architecture-evolution-principles.md) consistently so the core stays closed only where it owns state.

- `Ecosystem` should remain the source-side package semantics boundary.
- `Registry` should remain the package publication boundary.
- PR systems and Git operations should move into `SCMAdapter`.
- GitHub Release, assets, notifications, and deploy hooks should move into `CloseoutTarget`.
- workflow, proposal, target, policy, artifact, and plugin variation should stay open through refs and contracts instead of `*Kind` enums

This keeps the architecture modular enough to support:

- the current one-shot `pubm` flow
- split CI
- PR-based workflows like `release-please`
- future hosted/platform execution
