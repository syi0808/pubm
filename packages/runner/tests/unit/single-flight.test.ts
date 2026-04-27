import { describe, expect, it, vi } from "vitest";
import { InMemorySingleFlightRegistry } from "../../src/single-flight.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("InMemorySingleFlightRegistry", () => {
  it("coalesces concurrent work by key and clears the entry after settlement", async () => {
    const registry = new InMemorySingleFlightRegistry();
    const release = deferred<string>();
    const run = vi.fn(() => release.promise);

    const first = registry.run("asset", run);
    const second = registry.run("asset", run);

    expect(first).toBe(second);
    expect(run).toHaveBeenCalledTimes(1);

    release.resolve("built");

    await expect(first).resolves.toBe("built");
    await expect(second).resolves.toBe("built");

    await expect(registry.run("asset", async () => "rebuilt")).resolves.toBe(
      "rebuilt",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clears a single pending key without clearing other keys", async () => {
    const registry = new InMemorySingleFlightRegistry();
    const firstRelease = deferred<string>();
    const secondRelease = deferred<string>();

    const first = registry.run("first", () => firstRelease.promise);
    const second = registry.run("second", () => secondRelease.promise);

    registry.clear("first");

    const replacement = registry.run("first", async () => "replacement");

    expect(replacement).not.toBe(first);
    await expect(replacement).resolves.toBe("replacement");

    firstRelease.resolve("original");
    secondRelease.resolve("second");

    await expect(first).resolves.toBe("original");
    await expect(second).resolves.toBe("second");
  });

  it("clears only the empty-string key when one is provided", async () => {
    const registry = new InMemorySingleFlightRegistry();
    const emptyRelease = deferred<string>();
    const namedRelease = deferred<string>();

    const empty = registry.run("", () => emptyRelease.promise);
    const named = registry.run("named", () => namedRelease.promise);

    registry.clear("");

    const replacement = registry.run("", async () => "replacement");

    expect(replacement).not.toBe(empty);
    await expect(replacement).resolves.toBe("replacement");

    emptyRelease.resolve("empty");
    namedRelease.resolve("named");

    await expect(empty).resolves.toBe("empty");
    await expect(named).resolves.toBe("named");
  });

  it("clears all pending keys", async () => {
    const registry = new InMemorySingleFlightRegistry();
    const release = deferred<string>();
    const run = vi.fn(() => release.promise);

    const pending = registry.run("asset", run);
    registry.clear();

    await expect(registry.run("asset", async () => "new")).resolves.toBe("new");
    expect(run).toHaveBeenCalledTimes(1);

    release.resolve("old");
    await expect(pending).resolves.toBe("old");
  });
});
