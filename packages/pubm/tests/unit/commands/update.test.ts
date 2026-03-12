import { PUBM_VERSION } from "@pubm/core";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAutoUpdate, mockCreate } = vi.hoisted(() => ({
  mockAutoUpdate: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("update-kit", () => ({
  UpdateKit: {
    create: mockCreate,
  },
}));

import { registerUpdateCommand } from "../../../src/commands/update.js";

describe("registerUpdateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoUpdate.mockResolvedValue({
      kind: "success",
      fromVersion: "0.3.5",
      toVersion: "0.3.6",
      postAction: "none",
    });
    mockCreate.mockResolvedValue({
      autoUpdate: mockAutoUpdate,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes explicit package identity to UpdateKit", async () => {
    const parent = new Command();
    parent.exitOverride();
    registerUpdateCommand(parent);

    await parent.parseAsync(["node", "test", "update"]);

    expect(mockCreate).toHaveBeenCalledWith({
      appName: "pubm",
      currentVersion: PUBM_VERSION,
      sources: [{ type: "npm", packageName: "pubm" }],
      delegateMode: "execute",
    });
  });
});
