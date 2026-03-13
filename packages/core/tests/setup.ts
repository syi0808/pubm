import { afterEach, vi } from "vitest";
import { resetMockKeyring } from "./mock-keyring.js";

afterEach(() => {
  resetMockKeyring();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
