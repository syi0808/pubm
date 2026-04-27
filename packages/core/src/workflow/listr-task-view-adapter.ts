import type { ListrTask } from "listr2";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { createCiListrOptions, createListr } from "../utils/listr.js";
import type { RenderableTask, TaskViewAdapter, WorkflowStep } from "./types.js";

function toListrTasks(task: RenderableTask): ListrTask<PubmContext>[] {
  return Array.isArray(task)
    ? (task as ListrTask<PubmContext>[])
    : [task as ListrTask<PubmContext>];
}

export class ListrViewAdapter implements TaskViewAdapter {
  async run(ctx: PubmContext, steps: readonly WorkflowStep[]): Promise<void> {
    const tasks: ListrTask<PubmContext>[] = [];

    for (const step of steps) {
      const rendered = await step.tasks(ctx);
      tasks.push(...rendered.flatMap(toListrTasks));
    }

    const options = isCI ? createCiListrOptions<PubmContext>() : undefined;
    await createListr<PubmContext>(tasks, options).run(ctx);
  }
}
