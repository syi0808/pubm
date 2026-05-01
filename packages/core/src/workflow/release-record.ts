import type {
  WorkflowCompensationExpectation,
  WorkflowFactDescriptor,
  WorkflowReleaseRecord,
  WorkflowStep,
  WorkflowStepResult,
} from "./types.js";
import {
  cloneWorkflowVersionStepOutput,
  isWorkflowVersionStepOutput,
  type WorkflowVersionStepOutput,
} from "./version-step-output.js";

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
  private versionOutput: WorkflowVersionStepOutput | undefined;

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
    const output = isWorkflowVersionStepOutput(result.output)
      ? cloneWorkflowVersionStepOutput(result.output)
      : result.output;
    record.status = "completed";
    record.output = output;
    record.facts = result.facts ?? record.facts;

    if (step.id === "version") {
      if (isWorkflowVersionStepOutput(output)) {
        this.versionOutput = cloneWorkflowVersionStepOutput(output);
      }
      this.summary = versionSummaryFromOutput(output) ?? this.summary;
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

  versionStepOutput(): WorkflowVersionStepOutput | undefined {
    return this.versionOutput
      ? cloneWorkflowVersionStepOutput(this.versionOutput)
      : undefined;
  }

  snapshot(): readonly WorkflowStepRecord[] {
    return this.steps.map(cloneWorkflowStepRecord);
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

function cloneWorkflowStepRecord(
  record: WorkflowStepRecord,
): WorkflowStepRecord {
  const cloned: WorkflowStepRecord = {
    stepId: record.stepId,
    facts: record.facts.map(cloneFactDescriptor),
    compensation: record.compensation.map(cloneCompensationExpectation),
    status: record.status,
  };

  if ("input" in record) cloned.input = cloneRecordValue(record.input);
  if ("output" in record) cloned.output = cloneRecordOutput(record.output);
  if ("error" in record) cloned.error = cloneRecordValue(record.error);

  return cloned;
}

function cloneRecordOutput(output: unknown): unknown {
  return isWorkflowVersionStepOutput(output)
    ? cloneWorkflowVersionStepOutput(output)
    : cloneRecordValue(output);
}

function cloneFactDescriptor(
  fact: WorkflowFactDescriptor,
): WorkflowFactDescriptor {
  const cloned: WorkflowFactDescriptor = { ...fact };
  if ("detail" in fact) cloned.detail = cloneRecordDetail(fact.detail);
  return cloned;
}

function cloneCompensationExpectation(
  compensation: WorkflowCompensationExpectation,
): WorkflowCompensationExpectation {
  return { ...compensation };
}

function cloneRecordDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return detail
    ? (cloneRecordValue(detail) as Record<string, unknown>)
    : detail;
}

function cloneRecordValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRecordValue);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Error) return cloneRecordError(value);
  if (isWorkflowVersionStepOutput(value)) {
    return cloneWorkflowVersionStepOutput(value);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      cloneRecordValue(nested),
    ]),
  );
}

function cloneRecordError(error: Error): Error {
  const cloned = new Error(error.message);
  cloned.name = error.name;
  cloned.stack = error.stack;
  if ("cause" in error) {
    (cloned as Error & { cause?: unknown }).cause = (
      error as Error & { cause?: unknown }
    ).cause;
  }
  return cloned;
}
