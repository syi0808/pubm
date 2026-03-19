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

      deletePassword(): void {
        if (!keyringControl.available) {
          throw new Error("keyring unavailable");
        }

        delete keyringStore[this.field];
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

vi.mock("@napi-rs/keyring", () => ({
  default: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!keyringControl.installed) return undefined;
        const mod = loadMockKeyringModule();
        return mod[prop as keyof typeof mod];
      },
    },
  ),
}));

export { keyringControl, keyringStore };

export function resetMockKeyring(): void {
  for (const key of Object.keys(keyringStore)) {
    delete keyringStore[key];
  }

  keyringControl.installed = true;
  keyringControl.available = true;
}
