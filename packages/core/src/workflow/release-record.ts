import type {
  WorkflowCompensationExpectation,
  WorkflowFactDescriptor,
  WorkflowReleaseRecord,
  WorkflowStep,
  WorkflowStepResult,
} from "./types.js";

export interface WorkflowStepRecord {
  stepId: string;
  input?: unknown;
  output?: unknown;
  facts: readonly WorkflowFactDescriptor[];
  compensation: readonly WorkflowCompensationExpectation[];
  status: "started" | "completed" | "failed";
  error?: unknown;
}

export class InMemoryReleaseRecord implements WorkflowReleaseRecord {
  private readonly steps: WorkflowStepRecord[] = [];
  private summary: string | undefined;

  stepStarted(step: WorkflowStep): void {
    this.steps.push({
      stepId: step.id,
      input: step.input,
      facts: step.emittedFacts ?? [],
      compensation: step.compensation ?? [],
      status: "started",
    });
  }

  stepCompleted(step: WorkflowStep, result: WorkflowStepResult): void {
    const record = this.latest(step.id);
    if (!record) return;
    record.status = "completed";
    record.output = result.output;
    record.facts = result.facts ?? record.facts;

    if (step.id === "version") {
      this.summary = versionSummaryFromOutput(result.output) ?? this.summary;
    }
  }

  stepFailed(step: WorkflowStep, error: unknown): void {
    const record = this.latest(step.id);
    if (!record) return;
    record.status = "failed";
    record.error = error;
  }

  versionSummary(): string | undefined {
    return this.summary;
  }

  snapshot(): readonly WorkflowStepRecord[] {
    return this.steps.map((step) => ({ ...step }));
  }

  private latest(stepId: string): WorkflowStepRecord | undefined {
    return [...this.steps].reverse().find((step) => step.stepId === stepId);
  }
}

function versionSummaryFromOutput(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  if (!("summary" in output)) return undefined;
  const summary = (output as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : undefined;
}
