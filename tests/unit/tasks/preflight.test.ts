import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));
vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));
vi.mock("../../../src/utils/token.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/utils/token.js")>();
  return {
    ...original,
    loadTokensFromDb: vi.fn(),
    injectTokensToEnv: vi.fn(),
  };
});

import { exec } from "tinyexec";
import { collectTokens, syncGhSecrets } from "../../../src/tasks/preflight.js";
import { Db } from "../../../src/utils/db.js";
import { loadTokensFromDb } from "../../../src/utils/token.js";

const mockedExec = vi.mocked(exec);
const mockedDb = vi.mocked(Db);
const mockedLoadTokens = vi.mocked(loadTokensFromDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectTokens", () => {
  it("uses existing tokens from Db without prompting", async () => {
    mockedLoadTokens.mockReturnValue({ npm: "existing-token" });

    const mockTask = {
      output: "",
      prompt: vi.fn(),
    };

    const tokens = await collectTokens(["npm"], mockTask as any);

    expect(tokens).toEqual({ npm: "existing-token" });
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });

  it("prompts for missing tokens", async () => {
    mockedLoadTokens.mockReturnValue({});

    const mockPromptAdapter = {
      run: vi.fn().mockResolvedValue("new-token"),
    };
    const mockTask = {
      output: "",
      prompt: vi.fn().mockReturnValue(mockPromptAdapter),
    };

    const mockDbSet = vi.fn();
    mockedDb.mockImplementation(
      () => ({ get: vi.fn(), set: mockDbSet }) as any,
    );

    const tokens = await collectTokens(["npm"], mockTask as any);

    expect(tokens).toEqual({ npm: "new-token" });
    expect(mockDbSet).toHaveBeenCalledWith("npm-token", "new-token");
  });

  it("skips registries without token config", async () => {
    mockedLoadTokens.mockReturnValue({});

    const mockTask = {
      output: "",
      prompt: vi.fn(),
    };

    const tokens = await collectTokens(["custom-registry"], mockTask as any);

    expect(tokens).toEqual({});
    expect(mockTask.prompt).not.toHaveBeenCalled();
  });
});

describe("syncGhSecrets", () => {
  it("calls gh secret set for each token and writes to stdin", async () => {
    const mockStdin = { end: vi.fn() };
    const mockResult = Object.assign(Promise.resolve({ stdout: "", stderr: "" }), {
      process: { stdin: mockStdin },
    });
    mockedExec.mockReturnValue(mockResult as any);

    await syncGhSecrets({ npm: "tok-123", jsr: "tok-456" });

    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "NODE_AUTH_TOKEN"],
      { throwOnError: true },
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "gh",
      ["secret", "set", "JSR_TOKEN"],
      { throwOnError: true },
    );
    expect(mockStdin.end).toHaveBeenCalledWith("tok-123");
    expect(mockStdin.end).toHaveBeenCalledWith("tok-456");
  });

  it("throws when gh is not installed", async () => {
    const mockResult = Object.assign(Promise.reject(new Error("not found")), {
      process: undefined,
    });
    mockedExec.mockReturnValue(mockResult as any);

    await expect(syncGhSecrets({ npm: "tok-123" })).rejects.toThrow();
  });
});
