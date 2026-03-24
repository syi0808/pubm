import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { PluginTaskContext } from "./types.js";

/**
 * Wraps a listr2 TaskWrapper into the plugin-facing PluginTaskContext,
 * so plugins do not depend on listr2 internals.
 */
// biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
export function wrapTaskContext(listrTask: any): PluginTaskContext {
  return {
    get output() {
      return listrTask.output as string;
    },
    set output(v: string) {
      listrTask.output = v;
    },
    get title() {
      return listrTask.title as string;
    },
    set title(v: string) {
      listrTask.title = v;
    },
    prompt: (options) =>
      listrTask.prompt(ListrEnquirerPromptAdapter).run(options),
  };
}
