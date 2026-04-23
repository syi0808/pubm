# Architecture Evolution Principles

**Date:** 2026-04-23
**Status:** Draft

## Core Rule

`pubm` should evolve with a **closed core, open edge**:

- keep the core closed where the engine owns correctness, lifecycle progression, and recovery semantics
- keep the edge open where workflows, policies, targets, artifacts, and plugins vary by product choice or integration

## What Stays Closed

Closed enums or discriminants are justified only when the engine fully owns the vocabulary and needs exhaustive handling.

Primary examples:

- lifecycle state machines such as `ReleaseRecord.state`, `PublishRun.state`, and `CloseoutRecord.state`
- engine next-step vocabulary such as `NextAction`
- product-owned root command verbs such as `preflight`, `release`, `publish`, and `status`

If adding a new external provider would require editing a core enum, that axis is probably not core-owned and should not be closed.

Closed root verbs are product navigation, not proof that workflow selection should become a `WorkflowKind` enum.

## What Stays Open

Open extension axes should be modeled with references and observed capabilities, not global `kind` enums.

- use `*Key` for a configured or resolved instance identity
- use `*Ref` for a selected preset, contract, implementation, or adapter reference
- use `contractRef` for the behavioral contract the engine expects
- use `capabilityKeys` for optional features or observed abilities
- use digests, metadata, and evidence records for replayability instead of widening enums

## Read-Side Naming Rule

`Projection` is not a core/public architecture concept for `pubm`.

- public read boundaries should be described as query services, views, or normalized envelopes
- `projection` may exist only as an internal read-model or view-builder implementation detail
- do not make `projection` the name of a public SDK tier, CLI concept, or stable architecture layer

If a doc or export surface needs the word `projection` to explain the user-facing contract, that boundary is still too implementation-shaped.

## Default Patterns

Apply these patterns to the main extension seams:

- workflow selection: `workflow.ref` in config and `workflowRef` in machine output, not `WorkflowKind`
- proposal strategy: `workflow.proposalRef` in config and `proposalRef` in machine output, not `ProposalKind`
- target selection: `targetKey` + `targetRef` + `contractRef`, not a closed target-class enum
- policy binding: `policyRef` + `contractRef` + `policyDigest`, not `PolicyKind`
- artifact planning/materialization: `artifactSpecRef` + `artifactRef`, not `ArtifactKind`
- plugin integration: `pluginKey` + `pluginRef` + `capabilityKeys`, not `PluginKind`

Built-in options can still ship with the core, but they should be surfaced as namespaced refs such as `builtin:one-shot` or `builtin:npm`, not as proof that the axis is globally closed.

## Decision Test

Before introducing a new enum, ask:

1. Does the engine own this vocabulary end to end?
2. Would third-party or product-specific variants be architectural leakage rather than normal extension?
3. Does exhaustiveness change engine state progression or recovery behavior?

If the answer is not clearly yes, prefer `key` / `ref` / `capability` / `contract` modeling.

## Relationship To Other Docs

- [Release Platform Architecture](./2026-04-22-release-platform-architecture.md) should use this rule for internal contracts and adapter seams.
- [External Interface V1](./2026-04-22-external-interface-v1.md) should expose closed engine state only where necessary, while keeping workflow, proposal, target, policy, artifact, and plugin selection open.
- [Operational Surface Design](./2026-04-23-operational-surface-design.md) may keep a small closed set of root verbs while still modeling workflow selection as open refs under those verbs.
- [Status, Inspect, and Error Query/View Design](./2026-04-23-status-inspect-and-error-projections-design.md) should expose explicit query services, views, and error normalization rather than a generic projection layer.
