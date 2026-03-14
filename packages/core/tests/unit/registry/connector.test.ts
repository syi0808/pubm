import { describe, expect, it } from "vitest";
import { RegistryConnector } from "../../../src/registry/connector.js";

class TestConnector extends RegistryConnector {
  async ping(): Promise<boolean> {
    return true;
  }
  async isInstalled(): Promise<boolean> {
    return true;
  }
  async version(): Promise<string> {
    return "1.0.0";
  }
}

describe("RegistryConnector", () => {
  it("stores registryUrl", () => {
    const connector = new TestConnector("https://registry.npmjs.org");
    expect(connector.registryUrl).toBe("https://registry.npmjs.org");
  });

  it("requires ping, isInstalled, version methods", async () => {
    const connector = new TestConnector("https://example.com");
    expect(await connector.ping()).toBe(true);
    expect(await connector.isInstalled()).toBe(true);
    expect(await connector.version()).toBe("1.0.0");
  });
});
