# Visual Architecture and Interface Guide

**Date:** 2026-04-22
**Status:** Draft  
**Scope:** Architecture and external interface planning docs for pubm

## Rule for Future Architecture/Interface Plans

Every future architecture or interface planning doc in `docs/plans` must include:

1. a concise text model of behavior and tradeoffs
2. at least one Mermaid diagram using concrete terms from actual pubm contracts
3. one section that maps the diagram elements back to the source design docs (`release-platform-architecture` / `external-interface-v1`)

This avoids abstract-only plans and keeps implementation, docs, and API intent aligned.

## 1. Core State-Machine Architecture

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Plan: pubm preflight
  Idle --> Plan: pubm release
  Plan --> Propose: workflow.kind = release-pr
  Plan --> Release: workflow.kind = one-shot|split-ci
  Plan --> Recovery: blocking validation
  Propose --> Release: proposal approved/merged
  Propose --> Recovery: proposal stale/failed
  Release --> Publish: versioning + commit/tag complete
  Release --> Recovery: manifest or SCM materialization failed
  Publish --> Closing: all publish targets succeeded
  Publish --> PartiallyPublished: one+ targets failed
  PartiallyPublished --> Publish: pubm publish --retry failed
  PartiallyPublished --> Recovery: unrecoverable target failure
  Closing --> Closed: closeout completed
  Closing --> Recovery: closeout failed or timeout
  Recovery --> Plan: resume after corrective action
  Recovery --> Publish: resume publish for failed targets
  Recovery --> Closing: resume closeout
  Closed --> [*]
```

## 2. Ecosystem / Artifact / Target Composition

```mermaid
flowchart TB
  Repo["Git Repository"] --> RepoState["Git Snapshot + Commit Metadata"]
  RepoState --> Eco["EcosystemAdapter"]
  Eco --> Unit["ReleaseUnit"]
  Eco --> Art["ArtifactSpec (path/version/build artifacts)"]

  Unit --> Plan["ReleasePlan"]
  Art --> Plan
  Plan --> Record["ReleaseRecord"]
  Record --> Run["PublishRun"]

  Unit --> Cap["TargetCapabilities[]"]
  Cap --> Reg["RegistryTarget (npm, jsr, crates)"]
  Cap --> Dist["DistributionTarget (brew, winget, scoop)"]
  Cap --> Close["CloseoutTarget (github_release, notify)"]

  Reg --> Run
  Dist --> Run
  Close --> Run
  Run --> ES["ExecutionState[]"]
```

## 3. CLI Command Surface and Flow

```mermaid
flowchart LR
  subgraph User["Canonical Public Surface"]
    Alias["pubm [version]"] --> FlowAlias["alias to release + publish path"]
    Preflight["pubm preflight"] --> Plan["ReleasePlan"]
    Release["pubm release [version]"] --> Proposal["ReleaseProposal (optional)"] --> Record["ReleaseRecord"]
    Publish["pubm publish"] --> PublishRun["PublishRun"]
    Status["pubm status --json"] --> State["Plan/Proposal/Release/Publish state"]
    Inspect["pubm inspect packages|targets|plan"] --> View["Resolved source/target snapshot"]
  end

  Release --> Publish
  Record --> Publish
  PublishRun --> Status
  State --> PublishRun
```

## 4. Concrete Config Structure

```mermaid
flowchart TB
  CFG["pubm.config.ts"] --> WF["workflow"]
  CFG --> REL["release"]
  CFG --> PKG["packages"]
  CFG --> TGT["targets"]
  CFG --> VAL["validation"]
  CFG --> REC["recovery"]
  CFG --> PLG["plugins"]

  WF --> WFKind["workflow.kind: one-shot|split-ci|release-pr"]
  WF --> WFBranch["workflow.branch"]
  WF --> WFProposal["workflow.proposal: none|release_pr|manual"]

  REL --> VS["release.versioning.strategy"]
  REL --> VSrc["release.versioning.source"]
  REL --> CT["release.changelog.enabled/format"]
  REL --> TT["release.versioning.snapshotTemplate"]
  REL --> QTAG["release.versioning.registryQualifiedTags"]

  PKG --> PkgItem["packages[] = { path, manifestPath? }"]

  TGT --> Reg["targets.registries[]"]
  TGT --> Dist["targets.distributions[]"]
  TGT --> Close["targets.closeout.githubRelease.mode"]

  VAL --> Tests["validation.tests"]
  VAL --> Build["validation.build"]
  VAL --> Dry["validation.dryRunPublish"]

  REC --> Strategy["recovery.strategy"]
  REC --> Rollback["recovery.allowCompensation"]

  PLG --> PluginList["plugins[]"]
  PluginList --> PluginDef["pluginPath + options"]
```

## 5. Plugin Interface Boundary (Public vs Internal)

```mermaid
flowchart TB
  subgraph Public["Public Plugin Contract"]
    SDK["@pubm/core exports"]
    API["registerEcosystem / registerTarget / registerCloseout"]
    Schema["target schemas + options shape"]
  end

  subgraph Runtime["Internal Runtime"]
    Loader["PluginLoader"]
    Host["PluginHostContext"]
    Hooks["Internal Hooks: validate / publish / closeout / recover"]
  end
  SDK --> API
  SDK --> Schema
  User["pubm runtime"] --> Loader
  Loader --> Hooks
  Loader --> PluginPkg["Plugin package"]
  PluginPkg --> API
  PluginPkg -->|must not rely on| Host
  Hooks --> Host
```

## 6. ReleaseUnit / Artifact / TargetCapabilities / ExecutionState Relationship

```mermaid
classDiagram
  class ReleaseUnit {
    +key: string
    +ecosystem: string
    +packagePath: string
    +manifestPath: string
    +versionSource: string
  }
  class Artifact {
    +artifactId: string
    +unitKey: string
    +format: string
    +artifactPath: string
    +checksum: string
  }
  class TargetCapabilities {
    +targetKey: string
    +kind: string
    +requiresArtifact: boolean
    +canDryRun: boolean
    +canRetry: boolean
    +supportsRollback: boolean
  }
  class ExecutionState {
    +executionId: string
    +phase: string
    +targetKey: string
    +artifactId: string
    +status: string
    +attempt: number
    +lastError?: string
  }
  class ReleaseRecord {
    +recordId: string
    +planId: string
    +state: string
    +releaseSha: string
  }
  class PublishRun {
    +runId: string
    +releaseRecordId: string
    +targetStates: ExecutionState[]
  }

  ReleaseUnit "1" --> "*" Artifact : derives
  ReleaseUnit "1" --> "*" TargetCapabilities : owns target policy
  Artifact "*" --> "*" ExecutionState : executed as
  TargetCapabilities "*" --> "*" ExecutionState : constrains
  ReleaseRecord "1" --> "*" PublishRun : tracks
  PublishRun "1" --> "*" ExecutionState : owns
```

## Diagram assets

Keep these six standalone `.mmd` files as the render source:

- `docs/visuals/release-platform-core.mmd`
- `docs/visuals/distribution-model.mmd`
- `docs/visuals/cli-surface.mmd`
- `docs/visuals/config-surface.mmd`
- `docs/visuals/plugin-boundary.mmd`
- `docs/visuals/runtime-contracts.mmd`
