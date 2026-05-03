export type SemanticDetail = Record<string, unknown>;

export type SemanticEventName = string;

export interface SemanticEvent {
  name: SemanticEventName;
  target?: string;
  detail?: SemanticDetail;
}

export interface SemanticSideEffect {
  kind: string;
  target: string;
  detail?: SemanticDetail;
}

export interface SemanticCompensation {
  label: string;
  target?: string;
  confirm?: boolean;
}

export interface SemanticFact {
  name: string;
  value: unknown;
}

export interface SemanticPrompt {
  name: string;
  target?: string;
  type?: string;
  message?: string;
  response?: unknown;
  cancelled?: boolean;
}

export interface SemanticReleaseContext {
  displayLabel?: string;
  version?: string;
  tag?: string;
  releaseUrl?: string;
  releaseId?: string | number;
  assets?: unknown[];
}

export interface SemanticReleaseRequest {
  kind: "create" | "delete";
  target: string;
  detail?: SemanticDetail;
}

export interface SemanticChangesetState {
  consumed: string[];
  changelogs: { path: string; summary: string }[];
}

export interface SemanticLedger {
  events: SemanticEvent[];
  decisions: SemanticFact[];
  facts: SemanticFact[];
  sideEffects: SemanticSideEffect[];
  forbiddenSideEffects: SemanticSideEffect[];
  compensations: SemanticCompensation[];
  prompts: SemanticPrompt[];
  releaseContexts: SemanticReleaseContext[];
  releaseRequests: SemanticReleaseRequest[];
  changesetState: SemanticChangesetState;
  finalState: Record<string, unknown>;
}

export interface ReleaseBehaviorRecord {
  scenarioId: string;
  versionPlan: ReleaseVersionPlan;
  events: SemanticEvent[];
  sideEffects: SemanticSideEffect[];
  compensations: SemanticCompensation[];
  promptDecisions: SemanticPrompt[];
  releaseContexts: SemanticReleaseContext[];
  releaseRequests: SemanticReleaseRequest[];
  changesetState: SemanticChangesetState;
  finalState: Record<string, unknown>;
}

export type ReleaseScenarioMode = "release" | "snapshot";

export interface ReleaseScenarioPackage {
  name: string;
  path: string;
  currentVersion: string;
  registries: readonly string[];
  ecosystem?: "js" | "rust";
}

export interface ReleaseScenarioOptions {
  ci?: boolean;
  dryRun?: boolean;
  publishOnly?: boolean;
  registries?: readonly string[];
  tag?: string;
  [key: string]: unknown;
}

export interface ReleaseVersionChange {
  packageName: string;
  from: string;
  to: string;
}

export interface ReleaseVersionPlan {
  source: "explicit" | "manifest" | "snapshot";
  changes: readonly ReleaseVersionChange[];
}

export interface ReleaseFailureInjection {
  at: string;
  target?: string;
  error: string;
}

export interface ReleaseBehaviorScenario {
  id: string;
  description: string;
  mode: ReleaseScenarioMode;
  packages: readonly ReleaseScenarioPackage[];
  options: ReleaseScenarioOptions;
  versionPlan: ReleaseVersionPlan;
  expected: {
    sideEffects: readonly SemanticSideEffect[];
    forbiddenSideEffects: readonly SemanticSideEffect[];
    finalVersions: Record<string, string>;
    finalState?: Record<string, unknown>;
    compensationLabels: readonly string[];
  };
  failureInjection?: ReleaseFailureInjection;
}
