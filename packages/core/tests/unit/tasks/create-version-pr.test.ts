import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

async function freshImport() {
  vi.resetModules();
  return await import("../../../src/tasks/create-version-pr.js");
}

async function getMocks() {
  const { exec } = await import("../../../src/utils/exec.js");
  return { mockExec: vi.mocked(exec) };
}

describe("createVersionPr", () => {
  const originalFetch = global.fetch;

  const baseOptions = {
    branch: "pubm/version-packages-123",
    base: "main",
    title: "Version Packages",
    body: "# Version Packages\n\n...",
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
    labels: ["no-changeset"],
  };

  const optionsWithoutLabels = {
    branch: "pubm/version-packages-123",
    base: "main",
    title: "Version Packages",
    body: "# Version Packages\n\n...",
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
    labels: [],
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("creates PR via gh CLI when available", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockResolvedValueOnce({
      stdout: "https://github.com/test-owner/test-repo/pull/42\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await createVersionPr(baseOptions);

    expect(mockExec).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "create"]),
      expect.any(Object),
    );
    expect(result.url).toBe("https://github.com/test-owner/test-repo/pull/42");
  });

  it("falls back to GitHub API when gh CLI fails", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          html_url: "https://github.com/test-owner/test-repo/pull/42",
          number: 42,
        }),
    });
    global.fetch = mockFetch;

    const result = await createVersionPr(baseOptions);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/test-owner/test-repo/pulls",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.url).toBe("https://github.com/test-owner/test-repo/pull/42");
    expect(result.number).toBe(42);
  });

  it("throws when both gh CLI and API fail", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });
    global.fetch = mockFetch;

    await expect(createVersionPr(baseOptions)).rejects.toThrow();
  });

  it("does not add --label arg when labels array is empty (gh CLI path)", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockResolvedValueOnce({
      stdout: "https://github.com/test-owner/test-repo/pull/10\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await createVersionPr(optionsWithoutLabels);

    // Use the last call since mock accumulates across fresh imports
    const lastCallArgs = mockExec.mock.calls.at(-1)?.[1] as string[];
    expect(lastCallArgs).not.toContain("--label");
    expect(result.number).toBe(10);
  });

  it("returns number 0 when URL does not contain a pull number", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    // URL without /pull/NNN
    mockExec.mockResolvedValueOnce({
      stdout: "https://github.com/test-owner/test-repo\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await createVersionPr(baseOptions);

    expect(result.number).toBe(0);
  });

  it("calls labels API after creating PR when labels are present (API path)", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            html_url: "https://github.com/test-owner/test-repo/pull/42",
            number: 42,
          }),
      })
      .mockResolvedValueOnce({ ok: true }); // labels call

    global.fetch = mockFetch;

    await createVersionPr(baseOptions);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain(
      "/repos/test-owner/test-repo/issues/42/labels",
    );
  });

  it("does not call labels API when labels array is empty (API path)", async () => {
    const { createVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          html_url: "https://github.com/test-owner/test-repo/pull/5",
          number: 5,
        }),
    });

    global.fetch = mockFetch;

    const result = await createVersionPr(optionsWithoutLabels);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.number).toBe(5);
  });
});

describe("closeVersionPr", () => {
  const originalFetch = global.fetch;

  const baseOptions = {
    number: 42,
    token: "test-token",
    owner: "test-owner",
    repo: "test-repo",
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("closes PR via gh CLI when available", async () => {
    const { closeVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await closeVersionPr(baseOptions);

    expect(mockExec).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "close", "42"]),
      expect.any(Object),
    );
  });

  it("falls back to GitHub API when gh CLI fails", async () => {
    const { closeVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true });
    global.fetch = mockFetch;

    await closeVersionPr(baseOptions);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/test-owner/test-repo/pulls/42",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      }),
    );
  });

  it("does not throw when API returns 404 (PR already closed)", async () => {
    const { closeVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });
    global.fetch = mockFetch;

    await expect(closeVersionPr(baseOptions)).resolves.toBeUndefined();
  });

  it("throws when API returns non-404 error", async () => {
    const { closeVersionPr } = await freshImport();
    const { mockExec } = await getMocks();

    mockExec.mockRejectedValueOnce(new Error("gh not found"));

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });
    global.fetch = mockFetch;

    await expect(closeVersionPr(baseOptions)).rejects.toThrow();
  });
});
