import type { PubmContext } from "../context.js";
import { DirectReleaseWorkflow } from "./direct-release-workflow.js";
import { ListrViewAdapter } from "./listr-task-view-adapter.js";
import { ProcessSignalController } from "./process-signal-controller.js";
import type { WorkflowEventSink } from "./types.js";

const noopEvents: WorkflowEventSink = {
  emit: () => {},
};

export async function run(ctx: PubmContext): Promise<void> {
  const workflow = new DirectReleaseWorkflow();
  await workflow.run(ctx, {
    events: noopEvents,
    signals: new ProcessSignalController(),
    view: new ListrViewAdapter(),
  });
}

export default run;
