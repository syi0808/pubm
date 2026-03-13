import { vi } from "vitest";

const { keyringControl, keyringStore, loadMockKeyringModule } = vi.hoisted(
  () => {
    const keyringStore: Record<string, string> = {};
    const keyringControl = { installed: true, available: true };

    class MockKeyringEntry {
      constructor(
        _service: string,
        private readonly field: string,
      ) {}

      getPassword(): string | null {
        if (!keyringControl.available) {
          throw new Error("keyring unavailable");
        }

        return keyringStore[this.field] ?? null;
      }

      setPassword(value: string): void {
        if (!keyringControl.available) {
          throw new Error("keyring unavailable");
        }

        keyringStore[this.field] = value;
      }
    }

    function loadMockKeyringModule() {
      if (!keyringControl.installed) {
        throw new Error("keyring unavailable");
      }

      return { Entry: MockKeyringEntry };
    }

    return { keyringControl, keyringStore, loadMockKeyringModule };
  },
);

vi.mock("@napi-rs/keyring", () => loadMockKeyringModule());

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();

  return {
    ...actual,
    createRequire(filename: Parameters<typeof actual.createRequire>[0]) {
      const actualRequire = actual.createRequire(filename);
      const wrappedRequire = ((specifier: string) => {
        if (specifier === "@napi-rs/keyring") {
          return loadMockKeyringModule();
        }

        return actualRequire(specifier);
      }) as typeof actualRequire;

      return Object.assign(wrappedRequire, actualRequire);
    },
  };
});

export { keyringControl, keyringStore };

export function resetMockKeyring(): void {
  for (const key of Object.keys(keyringStore)) {
    delete keyringStore[key];
  }

  keyringControl.installed = true;
  keyringControl.available = true;
}
