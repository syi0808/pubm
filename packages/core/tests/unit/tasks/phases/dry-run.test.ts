import { describe, expect, it } from "vitest";
import { createDryRunTasks } from "../../../../src/tasks/phases/dry-run.js";

describe("createDryRunTasks", () => {
  it("returns enabled tasks when skipDryRun is false and ci+prepare", () => {
    const tasks = createDryRunTasks(false, "ci", true, false);
    expect(tasks[0].enabled).toBe(true);
  });

  it("returns disabled tasks when skipDryRun is true", () => {
    const tasks = createDryRunTasks(false, "ci", true, true);
    expect(tasks[0].enabled).toBe(false);
    expect(tasks[1].enabled).toBe(false);
  });

  it("returns disabled tasks when neither dryRun nor ci+prepare", () => {
    const tasks = createDryRunTasks(false, "local", false, false);
    expect(tasks[0].enabled).toBe(false);
  });

  it("returns enabled tasks when dryRun is true and skipDryRun is false", () => {
    const tasks = createDryRunTasks(true, "local", false, false);
    expect(tasks[0].enabled).toBe(true);
  });

  it("skipDryRun overrides dryRun flag", () => {
    const tasks = createDryRunTasks(true, "local", false, true);
    expect(tasks[0].enabled).toBe(false);
  });
});
