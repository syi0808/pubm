import type { PubmContext } from "../context.js";

export interface WorkflowEvent {
  type: string;
  stepId?: string;
  message?: string;
  detail?: Record<string, unknown>;
}

export interface WorkflowEventSink {
  emit(event: WorkflowEvent): void | Promise<void>;
}

export interface WorkflowFactDescriptor {
  name: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export interface WorkflowCompensationExpectation {
  name: string;
  target?: string;
  before?: string;
  after?: string;
}

export interface WorkflowStepResult<O = unknown> {
  output: O;
  facts?: readonly WorkflowFactDescriptor[];
}

export interface WorkflowStepContext {
  ctx: PubmContext;
  services: WorkflowServices;
}

export interface WorkflowStep<I = unknown, O = unknown> {
  id: string;
  input?: I;
  output?: O;
  emittedFacts?: readonly WorkflowFactDescriptor[];
  compensation?: readonly WorkflowCompensationExpectation[];
  run(input: I, context: WorkflowStepContext): Promise<WorkflowStepResult<O>>;
}

export interface WorkflowReleaseRecord {
  stepStarted(step: WorkflowStep): void;
  stepCompleted(step: WorkflowStep, result: WorkflowStepResult): void;
  stepFailed(step: WorkflowStep, error: unknown): void;
  versionSummary(): string | undefined;
}

export type SignalHandler = () => void | Promise<void>;

export interface SignalController {
  onInterrupt(handler: SignalHandler): () => void;
  dispose(): void;
}

export interface WorkflowServices {
  events: WorkflowEventSink;
  record: WorkflowReleaseRecord;
  signals: SignalController;
}

export interface WorkflowRunResult {
  status: "success";
}

export interface Workflow {
  name: string;
  run(ctx: PubmContext, services: WorkflowServices): Promise<WorkflowRunResult>;
  describe?(ctx: PubmContext): readonly WorkflowStep[];
}
