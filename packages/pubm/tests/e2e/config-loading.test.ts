import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPubmCli } from "../utils/cli.js";

const cliPath = path.resolve("src/cli.ts");

describe("Config file loading", () => {
  it("pubm --help still works without config file", async () => {
    const { stdout, exitCode } = await runPubmCli("bun", {}, cliPath, "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pubm");
  });
});
