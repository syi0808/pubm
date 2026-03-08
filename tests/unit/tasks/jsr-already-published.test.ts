import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
  JsrClient: { token: "fake-token" },
}));

import { jsrRegistry } from "../../../src/registry/jsr.js";
import { jsrPublishTasks } from "../../../src/tasks/jsr.js";

const mockedJsrRegistry = vi.mocked(jsrRegistry);

describe("jsrPublishTasks — already published", () => {
  const mockTask = {
    output: "",
    title: "Running jsr publish",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "Running jsr publish";
  });

  it("skips publish when version is already published", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "@scope/test",
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (jsrPublishTasks as any).task(ctx, mockTask);

    expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("skips publish when publish throws 'already published' error (fallback)", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockRejectedValue(
        new Error("Failed: version already published"),
      ),
      packageName: "@scope/test",
      packageCreationUrls: undefined,
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (jsrPublishTasks as any).task(ctx, mockTask);

    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "@scope/test",
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (jsrPublishTasks as any).task(ctx, mockTask);

    expect(mockJsr.publish).toHaveBeenCalled();
  });
});
