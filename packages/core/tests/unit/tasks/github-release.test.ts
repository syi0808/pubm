import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

async function freshImport() {
  vi.resetModules();
  return await import("../../../src/tasks/github-release.js");
}

async function getMocks() {
  const fs = await import("node:fs");
  const { exec } = await import("../../../src/utils/exec.js");
  const { Git } = await import("../../../src/git.js");

  return {
    mockExistsSync: vi.mocked(fs.existsSync),
    mockReaddirSync: vi.mocked(fs.readdirSync),
    mockReadFileSync: vi.mocked(fs.readFileSync),
    mockRmSync: vi.mocked(fs.rmSync),
    mockMkdirSync: vi.mocked(fs.mkdirSync),
    mockExec: vi.mocked(exec),
    mockGit: vi.mocked(Git),
  };
}

describe("createGitHubRelease", () => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken;
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("fails fast when GITHUB_TOKEN is missing", async () => {
    process.env.GITHUB_TOKEN = "";
    const { createGitHubRelease } = await freshImport();

    await expect(createGitHubRelease({ version: "1.0.0" })).rejects.toThrow(
      /GITHUB_TOKEN environment variable is required/,
    );
  });

  it("builds release notes from commits when no changelog body is provided", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(Buffer.from(""));
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
        latestTag: vi.fn().mockResolvedValue("v1.2.0"),
        previousTag: vi.fn().mockResolvedValue(null),
        firstCommit: vi.fn().mockResolvedValue("first-commit"),
        commits: vi.fn().mockResolvedValue([
          { id: "ignored", message: "ignored" },
          { id: "abcdef1234567", message: "feat: fix #42" },
        ]),
      } as any;
    } as any);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        html_url: "https://github.com/pubm/pubm/releases/tag/v1.2.0",
        upload_url:
          "https://uploads.github.com/repos/pubm/pubm/releases/1/assets{?name,label}",
      }),
    });
    global.fetch = fetchMock as any;

    const result = await createGitHubRelease({ version: "1.2.0" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.tag_name).toBe("v1.2.0");
    expect(payload.name).toBe("pubm v1.2.0");
    expect(payload.prerelease).toBe(false);
    expect(payload.body).toContain(
      "[#42](https://github.com/pubm/pubm/issues/42)",
    );
    expect(payload.body).toContain(
      "https://github.com/pubm/pubm/compare/first-commit...v1.2.0",
    );
    expect(result.assets).toEqual([]);
  });

  it("uses the provided changelog body, uploads platform binaries, and returns hashed assets", async () => {
    const { createGitHubRelease } = await freshImport();
    const {
      mockExistsSync,
      mockReaddirSync,
      mockReadFileSync,
      mockRmSync,
      mockMkdirSync,
      mockExec,
      mockGit,
    } = await getMocks();

    mockExistsSync.mockImplementation((target) => {
      const normalized = String(target);
      return (
        normalized.endsWith("/npm/@pubm") ||
        normalized.endsWith("/npm/@pubm/linux-x64/bin")
      );
    });
    mockReaddirSync.mockImplementation((target) => {
      const normalized = String(target);
      if (normalized.endsWith("/npm/@pubm")) {
        return [{ name: "linux-x64", isDirectory: () => true }] as any;
      }
      if (normalized.endsWith("/npm/@pubm/linux-x64/bin")) {
        return ["pubm"];
      }
      return [];
    });
    mockReadFileSync.mockImplementation((target) => {
      if (String(target).endsWith(".tar.gz")) {
        return Buffer.from("archive-bytes");
      }
      return Buffer.from("binary");
    });
    mockExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    mockGit.mockImplementation(function () {
      return {
        repository: vi.fn().mockResolvedValue("git@github.com:pubm/pubm.git"),
        latestTag: vi.fn().mockResolvedValue("v2.0.0-beta.1"),
        previousTag: vi.fn().mockResolvedValue("v1.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first-commit"),
        commits: vi.fn().mockResolvedValue([]),
      } as any;
    } as any);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          html_url: "https://github.com/pubm/pubm/releases/tag/v2.0.0-beta.1",
          upload_url:
            "https://uploads.github.com/repos/pubm/pubm/releases/2/assets{?name,label}",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          browser_download_url:
            "https://github.com/pubm/pubm/releases/download/v2.0.0-beta.1/pubm-linux-x64.tar.gz",
        }),
      });
    global.fetch = fetchMock as any;

    const result = await createGitHubRelease(
      {
        version: "2.0.0-beta.1",
        versions: new Map([
          ["@pubm/core", "2.0.0-beta.1"],
          ["pubm", "2.0.0-beta.1"],
        ]),
      },
      "Release notes from CHANGELOG",
    );

    const createPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(createPayload.name).toBe(
      "@pubm/core@2.0.0-beta.1, pubm@2.0.0-beta.1",
    );
    expect(createPayload.body).toBe("Release notes from CHANGELOG");
    expect(createPayload.prerelease).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/"),
      {
        recursive: true,
      },
    );
    expect(mockExec).toHaveBeenCalledWith(
      "tar",
      expect.arrayContaining(["-czf"]),
      expect.objectContaining({ throwOnError: true }),
    );
    expect(result.assets).toEqual([
      expect.objectContaining({
        name: "pubm-linux-x64.tar.gz",
        url: expect.stringContaining("pubm-linux-x64.tar.gz"),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/pubm-release-"),
      { recursive: true, force: true },
    );
  });

  it("surfaces GitHub API failures when creating the release", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockExistsSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
        latestTag: vi.fn().mockResolvedValue("v1.0.0"),
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([{ id: "skip", message: "skip" }]),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue("validation failed"),
    }) as any;

    await expect(createGitHubRelease({ version: "1.0.0" })).rejects.toThrow(
      /Failed to create GitHub Release \(422\): validation failed/,
    );
  });

  it("rejects invalid remote URLs before attempting release creation", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockGit } = await getMocks();

    mockGit.mockImplementation(function () {
      return {
        repository: vi.fn().mockResolvedValue("not-a-github-remote"),
      } as any;
    } as any);
    global.fetch = vi.fn() as any;

    await expect(createGitHubRelease({ version: "1.0.0" })).rejects.toThrow(
      /Cannot parse owner\/repo from remote URL/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
