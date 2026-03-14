import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckAndNotify, mockCheckUpdate, mockCreate } = vi.hoisted(() => ({
  mockCheckAndNotify: vi.fn(),
  mockCheckUpdate: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("update-kit", () => ({
  UpdateKit: {
    create: mockCreate,
  },
}));

import {
  checkUpdateStatus,
  notifyNewVersion,
} from "../../../src/utils/notify-new-version.js";
import { PUBM_VERSION } from "../../../src/utils/pubm-metadata.js";

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockCreate.mockResolvedValue({
    checkAndNotify: mockCheckAndNotify,
    checkUpdate: mockCheckUpdate,
  });
});

describe("notifyNewVersion", () => {
  it("creates UpdateKit with npm source for pubm", async () => {
    mockCheckAndNotify.mockResolvedValue(null);

    await notifyNewVersion();

    expect(mockCreate).toHaveBeenCalledWith({
      appName: "pubm",
      currentVersion: PUBM_VERSION,
      sources: [{ type: "npm", packageName: "pubm" }],
    });
  });

  it("prints banner to stderr when update is available", async () => {
    mockCheckAndNotify.mockResolvedValue("Update available: 1.0.0 → 2.0.0");

    await notifyNewVersion();

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith("Update available: 1.0.0 → 2.0.0");
  });

  it("does not print when no update is available", async () => {
    mockCheckAndNotify.mockResolvedValue(null);

    await notifyNewVersion();

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("checkUpdateStatus", () => {
  it("returns update status from UpdateKit with blocking mode", async () => {
    const mockStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    mockCheckUpdate.mockResolvedValue(mockStatus);

    const status = await checkUpdateStatus();

    expect(mockCreate).toHaveBeenCalledWith({
      appName: "pubm",
      currentVersion: PUBM_VERSION,
      sources: [{ type: "npm", packageName: "pubm" }],
    });
    expect(mockCheckUpdate).toHaveBeenCalledWith("blocking");
    expect(status).toEqual(mockStatus);
  });

  it("returns undefined when check fails", async () => {
    mockCheckUpdate.mockRejectedValue(new Error("network error"));

    const status = await checkUpdateStatus();

    expect(status).toBeUndefined();
  });
});
