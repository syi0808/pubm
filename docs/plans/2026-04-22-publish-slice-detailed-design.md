# Publish Slice Detailed Design

**Date:** 2026-04-22
**Status:** Draft
**Scope:** Concrete design for the publish slice: contracts, target planning semantics, execution engine, and handoff boundaries.

## Goal

Define a publish slice that consumes a durable `ReleaseRecord` and produces a durable `PublishRun`, while:

- keeping publish execution explicit and resumable,
- preserving typed artifacts only (`ReleasePlan`, `ReleaseRecord`, `PublishRun`, `CloseoutRecord`),
- avoiding a shared session/object request, and
- allowing explicit non-registry distribution targets such as `brew`.

The command slice must not introduce a monolithic request model (e.g., `Session` or `CommandRequest`) between release and publish; the only durable handoff inputs are the typed record artifacts and `PublishInput`.

This slice starts where `Release` ends and stops where `Closeout` begins.

## In Scope / Out of Scope

In scope:

- `PublishInput` contract.
- Target planning artifacts used by publish.
- `PublishEngine` responsibilities and boundaries.
- publish-time grouping/ordering.
- volatility revalidation at publish execution time.
- per-target execution semantics and retry behavior.
- handoff contracts to `Release` and `Closeout`.

Out of scope:

- plan-time versioning decisions.
- source mutation and commit/tag behavior.
- full closeout execution internals.
- rollout of all current task orchestration wiring.

## PublishInput

`PublishInput` is the narrow, command-level contract for this slice.

```ts
type PublishInput = {
  workflowKind: "one-shot" | "split-ci" | "release-pr";
  executionMode: "local" | "ci";
  from?: {
    planId?: string;
    releaseRecordId?: string;
    tag?: string;
  };
  scope?: {
    includePackageKeys?: string[];
    includeTargetKeys?: string[];
    includeKinds?: Array<"registry" | "distribution">;
    includeTargetPlanGroups?: string[];
  };
  retry?: "failed" | "all";
  closeoutMode?: "auto" | "skip";
};
```

### Invariants

- `from` must resolve to exactly one `ReleaseRecord` lineage (`tag`, `planId`, and `releaseRecordId` are mutually exclusive selectors).
- `scope.includeTargetPlanGroups` can only reduce scope; it must never widen beyond `ReleaseRecord`.
- `retry` is ignored when selected targets are first-run only.
- `closeoutMode` controls whether closeout should be launched after publish completion.

## Publish Engine Boundaries

Publish has a strict boundary with plan: it does **not** calculate intent or versions.

### Target Planning vs Execution Boundary

`ReleaseRecord` carries full publishable target declarations.

- **Planning boundary (Plan/Release ownership):** determine target set, per-unit policy flags, credentials/capabilities evidence, target ordering hints, and stable/draft validation evidence.
- **Execution boundary (`PublishEngine` ownership):** execute selected targets, rehydrate credentials, revalidate volatile checks, materialize artifacts, and persist per-target state.

This avoids execution-time inference from the current checkout or config snapshot.

## Target Contracts and Capabilities

Publish is driven by contracts derived from `ReleaseRecord.publishTargets`.

```ts
type PublishableTargetKind = "registry" | "distribution";

type TargetContract = {
  targetKey: string;
  targetKind: PublishableTargetKind;
  adapterKey: string;
  unitKey: string;
  packagePath: string;
  artifactSpecRef: string;
  artifactRef: string;
  orderGroup: string;
  requiredForCloseout: boolean;
  requiredForProgress: boolean;
  closeoutGroupingHint?: string;
};

type TargetCapabilities = {
  adapterKey: string;
  targetKind: PublishableTargetKind;
  canDryRun: boolean;
  canRetry: boolean;
  canReorder: boolean;
  supportsRollback: boolean;
  requiresWorkspaceProtocolResolution: boolean;
  requiresArtifactMaterialization: boolean;
  requiresCredential: boolean;
  requiresVolatileRecheck: boolean;
  maxAttempts: number;
  retryAfter?: number;
};

```

`TargetCapabilities` is runtime adapter metadata and is loaded from `adapterKey` during publish, not inferred from config.

```ts
type TargetOrderPlan = {
  groups: TargetOrderGroup[];
};

type TargetOrderGroup = {
  order: "serial" | "parallel";
  contracts: TargetContract[];
  gating: {
    requiredForProgress: boolean;
  };
};
```

### Current-to-Future Mapping for Contracts

Current sources:

- `packages/core/src/registry/catalog.ts` exposes per-registry publish behavior flags (`concurrentPublish`, `orderPackages`) and token metadata.
- `packages/core/src/tasks/grouping.ts` builds ecosystem/registry grouping and dedupes target lists.
- `packages/core/src/tasks/runner-utils/publish-tasks.ts` currently converts config into Listr execution graphs.

Future mapping:

- registry/distribution descriptors become runtime-loaded `TargetCapabilities`.
- grouping output becomes the seed input to `TargetOrderPlan`.
- existing execution tasks become target executors bound by contracts.

## Publish Engine Responsibilities and Non-Responsibilities

### Responsibilities

- load and validate `ReleaseRecord` lineage from `PublishInput.from`;
- load target contracts and filter/scope them according to `PublishInput.scope`;
- load `TargetCapabilities` from adapter metadata (`target.adapterKey`) before publish actions;
- rehydrate credentials and resolve non-secret capability evidence before publish actions;
- revalidate volatile target readiness before each target group executes;
- build deterministic target execution plan from contracts;
- materialize artifacts as required by target contracts;
- execute target contract groups (respects declared ordering and `canReorder`);
- emit per-target state and run-level `PublishRun`;
- set closeout handoff mode (`closeoutMode`) based on publish outcome.

### Non-Responsibilities

- resolving versions from manifests;
- deciding which packages belong in the release;
- deciding target topology from `ctx.config.packages`;
- deciding whether a package version is approved for release (comes from `ReleaseRecord`);
- creating GitHub Release, sending notifications, or repository finalization (handled by closeout slice).

## Publish-Time Volatile Revalidation

Plan-time checks can include prechecks that drift; publish must re-check them against current runtime conditions.

### Revalidation items

- registry reachability / network probes;
- package version availability and namespace checks;
- publish capability checks that depend on token/session TTL;
- lockfile or workspace protocol dependencies required by target tooling.

### Timing

1. Plan creates evidence that checks were attempted and passed.
2. `PublishEngine` rehydrates credentials in current process and re-checks drift-prone checks immediately before target execution.
3. If recheck fails, mark target state as failed and emit actionable `PublishRun` state for retries or manual recovery.

This is mandatory for split-CI because execution no longer happens in the same process as planning.

## Ordering / Grouping Model

The model keeps existing practical constraints while introducing explicit groups.

### Existing constraints carried forward

- Target tasks are grouped by ecosystem and registry.
- Some target executors need deterministic package order (for example crates dependency ordering).
- Some targets require serial execution (non-concurrent publishing).

### Group model

1. Build candidate `TargetContract[]` from `ReleaseRecord.publishTargets`.
2. Partition into `TargetOrderGroup[]`:
   - primary key: `orderGroup`;
   - within a group: parallel or serial execution;
   - between groups: serial.
3. Apply `PublishInput.scope` and `retry` strategy to select runnable contracts.
4. Persist each group result into `PublishRun.targetStates`.

### Suggested default ordering

- All groups are deterministic.
- Registry groups execute in group order:
  - ecosystem grouping first,
  - then registry sequencing inside that ecosystem.
- `concurrent` registries run package keys in parallel.
- `concurrent = false` registries run packages serially.
- Distribution targets follow registry target groups unless explicit closeout coupling requires earlier asset availability.

## PublishRun Shape and Invariants

```ts
type NextAction =
  | "release"
  | "publish"
  | "publish_retry_failed"
  | "publish_retry_all"
  | "resume_recovery"
  | "none";

type PublishRun = {
  id: string;
  releaseRecordId: string;
  startedAt: string;
  state:
    | "running"
    | "partial"
    | "published"
    | "failed"
    | "compensated";
  requested: PublishInput;
  targetStates: TargetState[];
  artifactBundles: ArtifactBundleRef[];
  completedAt?: string;
  nextAction?: NextAction;
};

type TargetState = {
  targetStateId: string;
  targetKey: string;
  unitKey: string;
  groupId: string;
  status: "queued" | "running" | "succeeded" | "skipped" | "failed" | "compensated";
  attempt: number;
  lastObservedAt: string;
  requiredForCloseout: boolean;
  mutableEvidence: {
    volatileChecks: "not-run" | "passed" | "failed";
    artifactMaterialized: boolean;
    startedAt?: string;
    finishedAt?: string;
    errorMessage?: string;
  };
};
```

### Invariants

- `releaseRecordId` must be set and equal to `ReleaseRecord.id`.
- `targetStates` is a complete snapshot of selected contracts at run start.
- every selected `TargetContract` must have exactly one corresponding `TargetState` stateful lifecycle.
- `state = published` implies all required non-skipped targets are `succeeded`.
- `state = partial` implies at least one selected target is `failed` and at least one target was attempted before failure.
- `nextAction` is set whenever `state` is `partial` or `failed`.

`Publish` only executes `registry` and `distribution` contracts; closeout is triggered via `closeoutMode` and handled by the Closeout slice.

## Target-level Failure and Retry Semantics

### Target status semantics

- `failed` means execution attempted and did not complete successfully.
- `skipped` is only for explicit skip preconditions (already published, filtered, disabled target).
- `compensated` is used only when `canRollback` + successful rollback callback.

### Run-level outcomes

- `published`: all required targets succeeded.
- `partial`: at least one target failed, at least one target succeeded, and replay is supported.
- `failed`: no required target succeeded or no targets executed.
- `compensated`: one or more required targets were rolled back and run exits clean.

### Retry semantics

- `retry=failed`:
  - only targets in `failed` status are eligible;
  - previously `succeeded` targets are not re-run unless contract marks `canRetry` and `maxAttempts > 1`;
  - optional best-effort targets can remain failed while allowing progression.
- `retry=all`:
  - reruns all non-skipped selected targets;
  - respects group ordering constraints and non-deterministic artifact rebuild guardrails.

Retry policy is deterministic and stored in `TargetState.attempt`.

## Release -> Publish Handoff

`Publish` consumes the record only and should not infer intent from checkout state.

From `Release` it gets:

- `ReleaseRecord.id` and exact `releaseSha`;
- `publishTargets` snapshot with publishable target kind, target key, artifact refs/spec refs, order groups, and requiredForCloseout/gating flags;
- tag and mode outputs;
- version map for all releasable units.

Allowed assumptions:

- versions in `ReleaseRecord` are authoritative;
- package filters are read from `ReleaseRecord` not current config selection;
- package contents and tags should match `releaseSha` before mutating targets.

## Publish -> Closeout Handoff

Closeout starts from `PublishRun` and `ReleaseRecord` only.

- `Closeout` inputs:
  - finalized `PublishRun` states,
  - emitted `artifactBundles`,
  - retry outcome and `nextAction`.
- Closeout is eligible when all required publish targets succeed (or `closeoutMode: skip` sets no-op).
- Distribution targets that create artifacts for closeout should record output metadata in `PublishRun.artifactBundles`.

This keeps closeout independent from target execution logic and supports hosted/incremental workflows.

## Current-to-Future Mapping (Publish Slice)

| Current code root | Current behavior | Publish-slice home |
|---|---|---|
| `packages/core/src/tasks/phases/publish.ts` | phase wrapper with hook calls and restore callbacks | Publish slice entrypoint + closeout boundary handoff |
| `packages/core/src/tasks/runner-utils/publish-tasks.ts` | ecosystem + registry grouping and task building | publish target ordering/planning adapter |
| `packages/core/src/tasks/grouping.ts` | ecosystem/registry grouping by package keys | target group builder input |
| `packages/core/src/tasks/phases/dry-run.ts` + `dry-run-publish.ts` | pre publish dry-run tasks | publish executor dry-run path and preconditions |
| `packages/core/src/registry/catalog.ts` | descriptors, auth metadata, concurrency hints | `TargetCapabilities` and target executors |
| `packages/core/src/tasks/npm.ts` | npm publish, OTP retry, unpublish rollback registration | registry target executor |
| `packages/core/src/tasks/jsr.ts` | jsr publish, package creation handling, token injection | registry target executor |
| `packages/core/src/tasks/crates.ts` + `crates` registry ordering hook | crates publish + dependency ordering | ordered target execution contracts |
| `packages/core/src/tasks/runner-utils/manifest-handling.ts` | resolve workspace protocols and restore manifests | publish execution pre-step and cleanup actions |
| `packages/core/src/tasks/phases/push-release.ts` | GitHub Release creation | closeout target responsibility (explicitly moved out of registry publishing) |
| `packages/plugins/plugin-brew/src/brew-tap.ts` | post-release formula update and push/PR logic | distribution target contract / closeout-aware handoff |
| `packages/core/src/required-conditions-check.ts` | availability checks and version probes | plan-time volatile evidence source, revalidated in publish |

## References to Existing Contracts

This design is compatible with:

- `release-platform-architecture` (`ReleasePlan`, `ReleaseRecord`, `PublishRun`, `CloseoutRecord`, `TargetCapabilities`, no session object),
- `external-interface-v1` (`publish` command, `--retry`, typed `PublishInput`),
- `low-level-migration-scope-plan` (scope 4: target contract and publish engine),
- `release-slice-detailed-design` (release->publish boundary and stable vs volatile evidence).

## Decision Summary

1. Publish consumes `ReleaseRecord` and a narrow `PublishInput` only.
2. Target intent (what) stays in planning artifacts; publish owns execution (how).
3. `TargetContract` + `TargetCapabilities` are the explicit adapter boundary.
4. Publish revalidates volatile readiness in execution process, not in prepare only.
5. `PublishRun` and per-target states are mandatory for partial failure visibility and deterministic retry.
6. brew can remain non-registry and still execute as explicit distribution targets.
7. Closeout does not run inside publish success paths except through `PublishRun` handoff.
