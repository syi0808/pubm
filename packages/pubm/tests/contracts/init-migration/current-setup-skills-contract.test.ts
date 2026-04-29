import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrompt = vi.hoisted(() => vi.fn());

vi.mock("@pubm/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pubm/runner")>()),
  prompt: mockPrompt,
}));

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    ui: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    },
  };
});

import { runSetupSkills } from "../../../src/commands/setup-skills.js";

const roots: string[] = [];
const fetchCalls: string[] = [];
let originalFetch: typeof globalThis.fetch;

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pubm-setup-skills-contract-"));
  roots.push(root);
  return root;
}

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "not found",
    json: vi.fn(async () => body),
    text: vi.fn(async () => String(body)),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls.length = 0;
  originalFetch = globalThis.fetch;
  mockPrompt.mockResolvedValue(["codex", "gemini"]);
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    fetchCalls.push(href);

    if (href.endsWith("/releases/latest")) {
      return mockResponse({}, false, 404);
    }
    if (href.includes("/git/trees/main?recursive=1")) {
      return mockResponse({
        tree: [
          {
            path: "plugins/pubm-plugin/skills/publish-setup/SKILL.md",
            type: "blob",
          },
          {
            path: "plugins/pubm-plugin/skills/publish-setup/references/config.md",
            type: "blob",
          },
          {
            path: "plugins/pubm-plugin/skills/create-plugin/SKILL.md",
            type: "blob",
          },
          {
            path: "README.md",
            type: "blob",
          },
        ],
      });
    }
    if (href.includes("raw.githubusercontent.com")) {
      return mockResponse(`downloaded:${href}`);
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("setup-skills command contract", () => {
  it("falls back to main when latest release lookup fails and installs every skill file for selected agents", async () => {
    const root = makeRoot();

    const result = await runSetupSkills(root);

    expect(result).toEqual({
      agents: ["codex", "gemini"],
      skillCount: 2,
    });
    expect(fetchCalls[0]).toContain("/releases/latest");
    expect(fetchCalls[1]).toContain("/git/trees/main?recursive=1");

    for (const agentPath of [".agents/skills/pubm", ".gemini/skills/pubm"]) {
      const skillPath = path.join(root, agentPath, "publish-setup", "SKILL.md");
      const referencePath = path.join(
        root,
        agentPath,
        "publish-setup",
        "references",
        "config.md",
      );
      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(referencePath)).toBe(true);
      expect(readFileSync(skillPath, "utf-8")).toContain(
        "raw.githubusercontent.com",
      );
    }
  });
});
