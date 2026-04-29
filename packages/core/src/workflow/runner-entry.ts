import type { PubmContext } from "../context.js";
import { DirectReleaseWorkflow } from "./direct-release-workflow.js";
import { ProcessSignalController } from "./process-signal-controller.js";
import { InMemoryReleaseRecord } from "./release-record.js";
import type { WorkflowEventSink } from "./types.js";

const noopEvents: WorkflowEventSink = {
  emit: () => {},
};

export async function run(ctx: PubmContext): Promise<void> {
  const workflow = new DirectReleaseWorkflow();
  await workflow.run(ctx, {
    events: noopEvents,
    record: new InMemoryReleaseRecord(),
    signals: new ProcessSignalController(),
  });
}

export default run;
