# Artifact and Closeout Design

## Goal

Define the Scope 5 seam from [2026-04-22-low-level-migration-scope-plan](./2026-04-22-low-level-migration-scope-plan.md) in enough detail to move `releaseAssets`, GitHub Release handling, and Homebrew onto explicit `Artifact` plus publish/closeout target contracts without changing the slice boundaries already established on 2026-04-22.

This memo builds directly on:

- [2026-04-22-release-platform-architecture](./2026-04-22-release-platform-architecture.md)
- [2026-04-22-publish-slice-detailed-design](./2026-04-22-publish-slice-detailed-design.md)
- [2026-04-22-release-slice-detailed-design](./2026-04-22-release-slice-detailed-design.md)
- [2026-04-22-low-level-external-interface-design](./2026-04-22-low-level-external-interface-design.md)
- [2026-04-22-pubm-self-hosting-pipeline-comparison](./2026-04-22-pubm-self-hosting-pipeline-comparison.md)

## Design Position

- `ReleaseRecord` remains the only durable `Release -> Publish` handoff.
- `PublishRun` remains the only durable `Publish -> Closeout` handoff.
- `GitHub Release` remains a `CloseoutTarget`, not a `Registry`.
- `brewTap` and `brewCore` remain `distribution` targets, not closeout targets.
- `releaseAssets` stops being a GitHub-specific feature and becomes an `ArtifactSpec` source.
- `closeoutDependencyKey` becomes the explicit join between distribution targets and prepared closeout surfaces.

## Closed Core, Open Edge Rule

This slice keeps engine-owned lifecycle states closed, but it should not freeze extension-facing artifact or target classification into core enums.

- artifact declarations should use open `category` plus optional contract or producer refs
- bindings from artifacts to targets should use target refs and target categories, not a closed target-class enum
- built-in labels such as `release_asset`, `distribution`, and `githubRelease` are examples and defaults, not the only future edge shapes

## Artifact Domain Model

The missing domain split is between declared artifacts, materialized artifacts, and externally addressable artifacts.

Use four layers:

1. `ArtifactSpec`: immutable declaration of what the release expects to exist.
2. `ArtifactRef`: immutable release-time binding from a target to one declared artifact.
3. `Artifact`: concrete publish-time materialization with checksum and platform metadata.
4. `ArtifactBundle`: durable publish output collected into `PublishRun.artifactBundleRefs`, including any prepared endpoint data needed by later consumers.

```ts
type ArtifactSpec = {
  id: string;
  unitKey: string;
  packagePath: string;
  category: string;
  contractRef?: string;
  producerRef?: string;
  sourcePattern: string;
  nameTemplate: string;
  platformSelector?: string;
};

type ArtifactRef = {
  id: string;
  artifactSpecRef: string;
  unitKey: string;
  targetRef: string;
  targetCategory: string;
  targetContractRef?: string;
  requiredForCloseout: boolean;
  closeoutDependencyKey?: string;
};

type Artifact = {
  id: string;
  artifactRef: string;
  filePath: string;
  fileName: string;
  sha256: string;
  platform?: string;
};

type ArtifactBundle = {
  id: string;
  releaseRecordId: string;
  publishRunId: string;
  unitKey: string;
  artifactIds: string[];
  endpointBindings: Array<{
    closeoutDependencyKey: string;
    state: "materialized" | "prepared" | "published";
    resolvedAssets: Array<{
      artifactId: string;
      url?: string;
      sha256: string;
    }>;
  }>;
};
```

Key rules:

- `ArtifactSpec` is the planning/release declaration and should be hashable into `ReleaseRecord`.
- `ArtifactRef` is what current `artifactRef` and `artifactSpecRef` fields in `ReleaseRecord.publishTargets` should point to logically, while keeping the target side key/ref based.
- `Artifact` is owned by `PublishEngine`; it is the first point where local file paths and checksums become durable facts.
- `ArtifactBundle` is the only cross-process representation of concrete assets and prepared endpoints.
- `endpointBindings` are closeout-owned publication facts keyed by `closeoutDependencyKey`; they let `brew` depend on prepared URLs without pretending GitHub Release is a registry publish.
- `endpointBindings.state` stays closed because it is engine-owned lifecycle state, not an extension axis.

## Publish vs Closeout Boundary

```mermaid
flowchart LR
  REC[ReleaseRecord] --> PUB[PublishEngine]
  PUB --> BND[ArtifactBundle]
  BND --> PREP[Prepared closeout dependency]
  PREP --> DIST[brew distribution]
  DIST --> RUN[PublishRun]
  RUN --> CLOSE[CloseoutEngine]
  CLOSE --> CREC[CloseoutRecord]
```

Boundary rules:

- `Publish` owns artifact materialization, registry execution, distribution execution, volatile revalidation, and persistence of `PublishRun.targetStates` plus `artifactBundleRefs`.
- `Closeout` owns `ReleaseRecord.closeoutTargets`, final public announcement, GitHub Release publication, notification/deploy side effects, and persistence of `CloseoutRecord`.
- A distribution target may depend on a prepared closeout surface, but it must not depend on closeout finalization.
- The dependency is declared ahead of time through `closeoutDependencyKey` on the publish target, not inferred during execution.
- For self-hosting `pubm`, draft release creation plus asset upload is not the final closeout action. It is closeout preparation required so the `brew` distribution target can consume stable URLs and checksums.
- Final publication of the GitHub Release still belongs to `CloseoutEngine`, consistent with [2026-04-22-release-platform-architecture](./2026-04-22-release-platform-architecture.md) and the nuance called out in [2026-04-22-pubm-self-hosting-pipeline-comparison](./2026-04-22-pubm-self-hosting-pipeline-comparison.md).

## Closeout Slice Proposal

The stable service boundary already exists as `CloseoutInput -> CloseoutRecord` in [2026-04-22-low-level-external-interface-design](./2026-04-22-low-level-external-interface-design.md). The missing part is the internal executor split.

Recommended internal shape:

- `CloseoutTarget` executors support two modes: `prepare` and `finalize`.
- `prepare` is idempotent, non-public, and only exists to satisfy `closeoutDependencyKey` requirements for publish-time distribution targets.
- `finalize` is the real closeout action and is the only path that contributes to `CloseoutRecord.state`.

Recommended passes:

1. Load `ReleaseRecord`, `PublishRun`, selected `CloseoutTarget`s, and referenced `ArtifactBundle`s.
2. Verify eligibility: required publish targets succeeded, requested closeout scope is valid, and required bundles exist.
3. Rehydrate or create prepared bindings for any dependency keys that were needed during publish.
4. Execute `finalize` for enabled closeout targets in deterministic order.
5. Persist one `CloseoutRecord` with performed target refs/categories, per-target outcomes, and `nextAction`.

Contract implications:

- `prepare` may run at the publish/closeout boundary, but ownership still belongs to the `CloseoutTarget` executor.
- `PublishEngine` can request prepared bindings by key; it must not create or finalize closeout targets directly.
- `CloseoutRecord` should describe finalized closeout work only. Prepared-but-not-finalized state belongs in `ArtifactBundle.endpointBindings` or equivalent closeout-preparation state, not in `ReleaseRecord`.
- This keeps `pubm publish` aligned with the existing `closeoutMode` contract while avoiding a hidden return to the current `afterRelease` coupling model.

## Mapping From Current Asset / GitHub Release / Brew Behavior

| Current root | Current behavior | Future home |
|---|---|---|
| `pubm.config.ts` `releaseAssets` | package-scoped asset declaration for `packages/pubm` platform binaries | `ArtifactSpec` source for `packages/pubm` release assets |
| `packages/core/src/assets/*` | resolve, transform, compress, name, and hash release assets | `PublishEngine` artifact materialization of `Artifact` values |
| `packages/core/src/tasks/runner-utils/manifest-handling.ts` `prepareReleaseAssets()` | selects matching asset group and runs the asset pipeline before GitHub release creation | publish-time `ArtifactBundle` materialization keyed by `ArtifactRef` |
| `packages/core/src/tasks/github-release.ts` | create GitHub release and upload assets in one API call | `CloseoutTarget(githubRelease)` executor split into `prepare` (draft + upload) and `finalize` (publish) |
| `packages/core/src/tasks/phases/push-release.ts` | orchestration hub that creates releases, registers rollback, appends uploaded assets, and invokes `afterRelease` hooks | removed as the ownership center; replaced by explicit publish output plus `CloseoutEngine` |
| `packages/plugins/plugin-brew/src/brew-tap.ts` | `afterRelease` hook that consumes `releaseCtx.assets`, updates a tap repo, then pushes or opens a PR | `DistributionTarget(brewTap)` consuming `ArtifactBundle.endpointBindings` for the GitHub closeout dependency |
| `packages/plugins/plugin-brew/src/brew-core.ts` | `afterRelease` hook that forks `homebrew-core`, updates the formula, and opens a PR | `DistributionTarget(brewCore)` with stronger SCM/approval semantics |
| `AssetPipelineHooks.uploadAssets` | plugin-added upload destinations piggybacking on release creation | explicit artifact publication backend under closeout preparation, or an explicit distribution target, but no longer hidden inside GitHub release creation |

Current self-hosting mapping for this repo becomes:

- `packages/pubm` binaries are declared as `ArtifactSpec`s.
- `Publish` materializes those binaries into an `ArtifactBundle`.
- `githubRelease.prepare` uploads those artifacts and returns stable URL/checksum bindings.
- `brewTap` consumes those prepared bindings as a `distribution` target.
- `githubRelease.finalize` publishes the draft during `Closeout`.

## Unresolved Risks

- Draft GitHub asset URLs may not be a stable fetch surface for Homebrew in every repository visibility mode. If draft URLs are private or auth-gated, `brew` may need a different artifact publication backend.
- The current repo has many independent package tags but only one meaningful asset-producing unit (`packages/pubm`). The design still needs a hard rule for when a closeout target is unit-scoped versus release-scoped.
- Retry semantics across `prepare` and `finalize` are still open. A rerun must rehydrate existing draft releases and uploaded assets instead of duplicating them.
- Current rollback for release deletion and PR closure is stored in in-memory closures. Scope 6 will need durable external IDs before artifact/closeout recovery is trustworthy.
- `plugin-brew` and current asset hooks are phase-coupled today. A compatibility layer may be required before Scope 8 can expose a stable plugin target API.
- Additional non-GitHub asset upload backends are still classification-sensitive. Some are likely closeout preparation backends; others may really be distribution targets.

## Recommendation

Adopt `ArtifactSpec -> ArtifactRef -> Artifact -> ArtifactBundle` as the durable model, keep `brew` in `Publish` as a built-in `distribution`-category target, keep GitHub Release finalization in `Closeout`, and introduce explicit closeout preparation keyed by `closeoutDependencyKey` instead of relying on `afterRelease` hook coupling.
