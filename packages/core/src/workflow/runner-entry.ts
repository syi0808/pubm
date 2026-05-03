import type { TaskContext } from "@pubm/runner";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import {
  DirectReleaseWorkflow,
  runWorkflowStep,
} from "./direct-release-workflow.js";
import { ProcessSignalController } from "./process-signal-controller.js";
import {
  createReleaseOperationRunner,
  createReleaseOperationTasks,
} from "./release-operation-task.js";
import { InMemoryReleaseRecord } from "./release-record.js";
import type {
  WorkflowEventSink,
  WorkflowServices,
  WorkflowStep,
} from "./types.js";

const noopEvents: WorkflowEventSink = {
  emit: () => {},
};

function runnerOptions<Context extends object>(concurrent?: boolean | number) {
  const options = concurrent === undefined ? {} : { concurrent };
  return isCI ? createCiListrOptions<Context>(options) : options;
}

function createRenderedWorkflowServices(): WorkflowServices {
  const services: WorkflowServices = {
    events: noopEvents,
    record: new InMemoryReleaseRecord(),
    signals: new ProcessSignalController(),
  };

  services.operations = {
    run: async (ctx, operations, options) => {
      await createListr(
        createReleaseOperationTasks(operations),
        runnerOptions<PubmContext>(options?.concurrent),
      ).run(ctx);
    },
  };

  services.steps = {
    run: async (steps, ctx, baseServices) => {
      await createListr(
        steps.map((step: WorkflowStep) => ({
          title: step.title ?? step.id,
          enabled: step.enabled,
          task: async (ctx: PubmContext, task: TaskContext<PubmContext>) => {
            await runWorkflowStep(step, {
              ctx,
              services: {
                ...baseServices,
                operations: createReleaseOperationRunner(task),
              },
            });
          },
        })),
        runnerOptions<PubmContext>(),
      ).run(ctx);
    },
  };

  return services;
}

export async function run(ctx: PubmContext): Promise<void> {
  const workflow = new DirectReleaseWorkflow();
  await workflow.run(ctx, createRenderedWorkflowServices());
}

export default run;
