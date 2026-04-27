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

export type RenderableTask = unknown;

export interface WorkflowStep {
  id: string;
  tasks(
    ctx: PubmContext,
  ): readonly RenderableTask[] | Promise<readonly RenderableTask[]>;
}

export interface TaskViewAdapter {
  run(ctx: PubmContext, steps: readonly WorkflowStep[]): Promise<void>;
}

export type SignalHandler = () => void | Promise<void>;

export interface SignalController {
  onInterrupt(handler: SignalHandler): () => void;
  dispose(): void;
}

export interface WorkflowServices {
  events: WorkflowEventSink;
  signals: SignalController;
  view: TaskViewAdapter;
}

export interface WorkflowRunResult {
  status: "success";
}

export interface Workflow {
  name: string;
  run(ctx: PubmContext, services: WorkflowServices): Promise<WorkflowRunResult>;
  describe?(ctx: PubmContext): readonly WorkflowStep[];
}
