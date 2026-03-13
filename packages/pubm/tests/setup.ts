import { afterEach, vi } from "vitest";
import { resetMockKeyring } from "../../core/tests/mock-keyring.js";

afterEach(() => {
  resetMockKeyring();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
