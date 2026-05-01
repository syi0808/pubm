import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
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
  const { Git } = await import("../../../src/git.js");

  return {
    mockReadFileSync: vi.mocked(fs.readFileSync),
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

    await expect(
      createGitHubRelease({} as any, {
        displayLabel: "pubm",
        version: "1.0.0",
        tag: "v1.0.0",
        body: "",
        assets: [],
      }),
    ).rejects.toThrow(/GITHUB_TOKEN environment variable is required/);
  });

  it("uses the provided body directly", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockReadFileSync, mockGit } = await getMocks();

    mockReadFileSync.mockReturnValue(Buffer.from(""));
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
      } as any;
    } as any);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 1,
        html_url: "https://github.com/pubm/pubm/releases/tag/v1.2.0",
        upload_url:
          "https://uploads.github.com/repos/pubm/pubm/releases/1/assets{?name,label}",
      }),
    });
    global.fetch = fetchMock as any;

    const result = await createGitHubRelease({} as any, {
      displayLabel: "pubm",
      version: "1.2.0",
      tag: "v1.2.0",
      body: "### Features\n\n- fix #42 (abcdef1)",
      assets: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.tag_name).toBe("v1.2.0");
    expect(payload.name).toBe("v1.2.0");
    expect(payload.prerelease).toBe(false);
    expect(payload.body).toBe("### Features\n\n- fix #42 (abcdef1)");
    expect(result?.assets).toEqual([]);
    expect(result?.displayLabel).toBe("pubm");
  });

  it("uses the provided changelog body and marks pre-releases correctly", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockGit } = await getMocks();

    mockGit.mockImplementation(function () {
      return {
        repository: vi.fn().mockResolvedValue("git@github.com:pubm/pubm.git"),
      } as any;
    } as any);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 2,
        html_url: "https://github.com/pubm/pubm/releases/tag/v2.0.0-beta.1",
        upload_url:
          "https://uploads.github.com/repos/pubm/pubm/releases/2/assets{?name,label}",
      }),
    });
    global.fetch = fetchMock as any;

    const result = await createGitHubRelease({} as any, {
      displayLabel: "pubm",
      version: "2.0.0-beta.1",
      tag: "v2.0.0-beta.1",
      body: "Release notes from CHANGELOG",
      assets: [],
    });

    const createPayload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(createPayload.name).toBe("v2.0.0-beta.1");
    expect(createPayload.body).toBe("Release notes from CHANGELOG");
    expect(createPayload.prerelease).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.assets).toEqual([]);
  });

  it("uploads PreparedAssets and returns hashed ReleaseAssets", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockReadFileSync, mockGit } = await getMocks();

    mockReadFileSync.mockReturnValue(Buffer.from("archive-bytes"));
    mockGit.mockImplementation(function () {
      return {
        repository: vi.fn().mockResolvedValue("git@github.com:pubm/pubm.git"),
      } as any;
    } as any);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 2,
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

    const platform = { raw: "linux-x64", os: "linux", arch: "x64" };
    const result = await createGitHubRelease({} as any, {
      displayLabel: "pubm",
      version: "2.0.0-beta.1",
      tag: "v2.0.0-beta.1",
      body: "Release notes from CHANGELOG",
      assets: [
        {
          filePath: "/tmp/pubm-linux-x64.tar.gz",
          name: "pubm-linux-x64.tar.gz",
          sha256:
            "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
          platform,
          originalPath: "/tmp/pubm",
          compressFormat: "tar.gz",
          config: { path: "/tmp/pubm", compress: "tar.gz", name: "pubm" },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.assets).toEqual([
      {
        name: "pubm-linux-x64.tar.gz",
        url: "https://github.com/pubm/pubm/releases/download/v2.0.0-beta.1/pubm-linux-x64.tar.gz",
        sha256:
          "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        platform,
      },
    ]);
  });

  it("skips gracefully when the release already exists (HTTP 422)", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockGit } = await getMocks();

    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          message: "Validation Failed",
          errors: [
            {
              code: "already_exists",
              message: "Release already exists",
            },
          ],
        }),
      ),
    }) as any;

    const result = await createGitHubRelease({} as any, {
      displayLabel: "pubm",
      version: "1.0.0",
      tag: "v1.0.0",
      body: "some body",
      assets: [],
    });

    expect(result).toBeNull();
  });

  it("surfaces generic GitHub validation failures when no already-existing release detail is present", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockGit } = await getMocks();

    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue('{"message":"Validation Failed"}'),
    }) as any;

    await expect(
      createGitHubRelease({} as any, {
        displayLabel: "pubm",
        version: "1.0.0",
        tag: "v1.0.0",
        body: "some body",
        assets: [],
      }),
    ).rejects.toThrow(
      /Failed to create GitHub Release \(422\): {"message":"Validation Failed"}/,
    );
  });

  it("surfaces GitHub API failures when creating the release", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockGit } = await getMocks();

    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("internal server error"),
    }) as any;

    await expect(
      createGitHubRelease({} as any, {
        displayLabel: "pubm",
        version: "1.0.0",
        tag: "v1.0.0",
        body: "some body",
        assets: [],
      }),
    ).rejects.toThrow(
      /Failed to create GitHub Release \(500\): internal server error/,
    );
  });

  it("surfaces GitHub API failures when uploading release assets", async () => {
    const { createGitHubRelease } = await freshImport();
    const { mockReadFileSync, mockGit } = await getMocks();

    mockReadFileSync.mockReturnValue(Buffer.from("archive-bytes"));
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/pubm/pubm.git"),
      } as any;
    } as any);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 1,
          html_url: "https://github.com/pubm/pubm/releases/tag/v1.2.0",
          upload_url:
            "https://uploads.github.com/repos/pubm/pubm/releases/1/assets{?name,label}",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("upload failed"),
      }) as any;

    await expect(
      createGitHubRelease({} as any, {
        displayLabel: "pubm",
        version: "1.2.0",
        tag: "v1.2.0",
        body: "some body",
        assets: [
          {
            filePath: "/tmp/pubm-linux-x64.tar.gz",
            name: "pubm-linux-x64.tar.gz",
            sha256: "abc123",
            platform: { raw: "linux-x64" },
            originalPath: "/tmp/pubm",
            compressFormat: "tar.gz",
            config: { path: "/tmp/pubm", compress: "tar.gz", name: "pubm" },
          },
        ],
      }),
    ).rejects.toThrow(
      /Failed to upload asset pubm-linux-x64\.tar\.gz \(500\): upload failed/,
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

    await expect(
      createGitHubRelease({} as any, {
        displayLabel: "pubm",
        version: "1.0.0",
        tag: "v1.0.0",
        body: "",
        assets: [],
      }),
    ).rejects.toThrow(/Cannot parse owner\/repo from remote URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("deleteGitHubRelease", () => {
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

  it("throws when GITHUB_TOKEN is missing", async () => {
    process.env.GITHUB_TOKEN = "";
    const { deleteGitHubRelease } = await freshImport();

    await expect(deleteGitHubRelease(12345)).rejects.toThrow(
      "GITHUB_TOKEN environment variable is required",
    );
  });

  it("deletes a release successfully", async () => {
    const { mockGit } = await getMocks();
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/owner/repo.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as any;

    const { deleteGitHubRelease } = await freshImport();
    await expect(deleteGitHubRelease(12345)).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/releases/12345",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("ignores 404 response", async () => {
    const { mockGit } = await getMocks();
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/owner/repo.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("Not Found"),
    }) as any;

    const { deleteGitHubRelease } = await freshImport();
    await expect(deleteGitHubRelease(99999)).resolves.toBeUndefined();
  });

  it("throws on non-404 error response", async () => {
    const { mockGit } = await getMocks();
    mockGit.mockImplementation(function () {
      return {
        repository: vi
          .fn()
          .mockResolvedValue("https://github.com/owner/repo.git"),
      } as any;
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("Internal Server Error"),
    }) as any;

    const { deleteGitHubRelease } = await freshImport();
    await expect(deleteGitHubRelease(12345)).rejects.toThrow(
      "Failed to delete GitHub Release 12345 (500)",
    );
  });
});
