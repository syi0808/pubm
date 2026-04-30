import { describe, expect, it } from "vitest";
import { createLiveCommandOutput } from "../../../../src/workflow/release-utils/output-formatting.js";

function createOutputRecorder() {
  const history: string[] = [];
  const task = {
    get output() {
      return history.at(-1) ?? "";
    },
    set output(value: string) {
      history.push(value);
    },
  };

  return { history, task };
}

describe("createLiveCommandOutput", () => {
  it("renders a command fallback before live output receives visible lines", () => {
    const { history, task } = createOutputRecorder();
    const liveOutput = createLiveCommandOutput(task, "bun run test");

    expect(task.output).toBe("Executing `bun run test`");

    liveOutput.onStdout("\n");
    liveOutput.finish();

    expect(history).toEqual(["Executing `bun run test`"]);
  });

  it("previews pending stdout and stderr before finish flushes them", () => {
    const { history, task } = createOutputRecorder();
    const liveOutput = createLiveCommandOutput(task, "bun run test");

    liveOutput.onStdout("stdout partial");
    liveOutput.onStderr("stderr partial");
    const preview = history.at(-1);
    const beforeFinish = history.length;

    expect(preview).toBe("stdout partial\nstderr partial");

    liveOutput.finish();

    expect(history.at(-1)).toBe(preview);
    expect(history).toHaveLength(beforeFinish);
  });
});
