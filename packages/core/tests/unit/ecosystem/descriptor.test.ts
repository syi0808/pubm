import { describe, expect, it } from "vitest";
import { JsEcosystemDescriptor } from "../../../src/ecosystem/js-descriptor.js";
import { RustEcosystemDescriptor } from "../../../src/ecosystem/rust-descriptor.js";

describe("JsEcosystemDescriptor", () => {
  it("returns npmName as displayName when both exist", () => {
    const d = new JsEcosystemDescriptor(
      "packages/core",
      "@pubm/core",
      "@jsr/pubm-core",
    );
    expect(d.displayName).toBe("@pubm/core");
  });

  it("returns jsrName as displayName when npm is absent", () => {
    const d = new JsEcosystemDescriptor(
      "packages/core",
      undefined,
      "@jsr/pubm-core",
    );
    expect(d.displayName).toBe("@jsr/pubm-core");
  });

  it("falls back to path when no names exist", () => {
    const d = new JsEcosystemDescriptor("packages/core");
    expect(d.displayName).toBe("packages/core");
  });

  it("returns label with jsr in parentheses when names differ", () => {
    const d = new JsEcosystemDescriptor(
      "packages/core",
      "@pubm/core",
      "@jsr/pubm-core",
    );
    expect(d.displayLabel).toBe("@pubm/core (@jsr/pubm-core)");
  });

  it("returns plain displayName as label when names are identical", () => {
    const d = new JsEcosystemDescriptor(
      "packages/core",
      "@pubm/core",
      "@pubm/core",
    );
    expect(d.displayLabel).toBe("@pubm/core");
  });

  it("returns plain displayName as label when only npm exists", () => {
    const d = new JsEcosystemDescriptor("packages/core", "@pubm/core");
    expect(d.displayLabel).toBe("@pubm/core");
  });

  it("returns jsr as label when only jsr exists", () => {
    const d = new JsEcosystemDescriptor(
      "packages/core",
      undefined,
      "@jsr/pubm-core",
    );
    expect(d.displayLabel).toBe("@jsr/pubm-core");
  });
});

describe("RustEcosystemDescriptor", () => {
  it("returns cratesName as displayName", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate", "my-crate");
    expect(d.displayName).toBe("my-crate");
  });

  it("falls back to path when no crates name", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate");
    expect(d.displayName).toBe("crates/my-crate");
  });

  it("displayLabel equals displayName", () => {
    const d = new RustEcosystemDescriptor("crates/my-crate", "my-crate");
    expect(d.displayLabel).toBe("my-crate");
  });
});
