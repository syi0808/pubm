import { describe, expect, it, vi } from "vitest";
import {
  EcosystemCatalog,
  type EcosystemDescriptor,
  ecosystemCatalog,
} from "../../../src/ecosystem/catalog.js";

function createDescriptor(
  overrides: Partial<EcosystemDescriptor> = {},
): EcosystemDescriptor {
  return {
    key: "js",
    label: "JavaScript",
    defaultRegistries: ["npm", "jsr"],
    ecosystemClass: class {} as any,
    detect: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("EcosystemCatalog", () => {
  it("registers and retrieves a descriptor by key", () => {
    const catalog = new EcosystemCatalog();
    const desc = createDescriptor({ key: "js" });
    catalog.register(desc);
    expect(catalog.get("js")).toBe(desc);
  });

  it("returns undefined for unregistered key", () => {
    const catalog = new EcosystemCatalog();
    expect(catalog.get("unknown")).toBeUndefined();
  });

  it("returns all registered descriptors", () => {
    const catalog = new EcosystemCatalog();
    const js = createDescriptor({ key: "js" });
    const rust = createDescriptor({ key: "rust" });
    catalog.register(js);
    catalog.register(rust);
    expect(catalog.all()).toEqual([js, rust]);
  });

  it("removes a registered descriptor", () => {
    const catalog = new EcosystemCatalog();
    catalog.register(createDescriptor({ key: "test" }));
    expect(catalog.remove("test")).toBe(true);
    expect(catalog.get("test")).toBeUndefined();
  });

  it("returns false when removing a non-existent key", () => {
    const catalog = new EcosystemCatalog();
    expect(catalog.remove("nonexistent")).toBe(false);
  });

  it("detects ecosystem by calling detect functions in order", async () => {
    const catalog = new EcosystemCatalog();
    const jsDetect = vi.fn().mockResolvedValue(false);
    const rustDetect = vi.fn().mockResolvedValue(true);
    catalog.register(createDescriptor({ key: "js", detect: jsDetect }));
    catalog.register(createDescriptor({ key: "rust", detect: rustDetect }));

    const result = await catalog.detect("/some/path");
    expect(result?.key).toBe("rust");
  });

  it("returns null when no ecosystem detected", async () => {
    const catalog = new EcosystemCatalog();
    catalog.register(
      createDescriptor({ detect: vi.fn().mockResolvedValue(false) }),
    );
    const result = await catalog.detect("/empty/path");
    expect(result).toBeNull();
  });
});

describe("default registrations", () => {
  it("has js ecosystem registered", () => {
    const js = ecosystemCatalog.get("js");
    expect(js).toBeDefined();
    expect(js!.label).toBe("JavaScript");
    expect(js!.defaultRegistries).toEqual(["npm", "jsr"]);
  });

  it("has rust ecosystem registered", () => {
    const rust = ecosystemCatalog.get("rust");
    expect(rust).toBeDefined();
    expect(rust!.label).toBe("Rust");
    expect(rust!.defaultRegistries).toEqual(["crates"]);
  });

  it("js detect function returns false for nonexistent path", async () => {
    const js = ecosystemCatalog.get("js")!;
    const result = await js.detect("/nonexistent/path/that/does/not/exist");
    expect(result).toBe(false);
  });

  it("rust detect function returns false for nonexistent path", async () => {
    const rust = ecosystemCatalog.get("rust")!;
    const result = await rust.detect("/nonexistent/path/that/does/not/exist");
    expect(result).toBe(false);
  });
});
