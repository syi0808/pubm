import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

import { exec } from "../../../src/utils/exec.js";
import { npmInstallGlobally } from "../../../src/utils/npm-install.js";

const mockedExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("npmInstallGlobally", () => {
  it("calls exec with npm install -g and the package name", async () => {
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await npmInstallGlobally("jsr");

    expect(mockedExec).toHaveBeenCalledWith("npm", ["install", "-g", "jsr"], {
      throwOnError: true,
    });
  });

  it("propagates errors from exec", async () => {
    mockedExec.mockRejectedValue(new Error("npm install failed"));

    await expect(npmInstallGlobally("bad-pkg")).rejects.toThrow(
      "npm install failed",
    );
  });
});
