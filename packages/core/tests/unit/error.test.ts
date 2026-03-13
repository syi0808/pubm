import { describe, expect, it, vi } from "vitest";
import { AbstractError, consoleError } from "../../src/error.js";

describe("AbstractError", () => {
  it("should create an error with a message", () => {
    const error = new AbstractError("something went wrong");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AbstractError);
    expect(error.message).toBe("something went wrong");
    expect(error.name).toBe("Error");
  });

  it("should have an undefined cause by default", () => {
    const error = new AbstractError("no cause");

    expect(error.cause).toBeUndefined();
  });

  it("should accept a cause option", () => {
    const cause = new Error("root cause");
    const error = new AbstractError("wrapper", { cause });

    expect(error.cause).toBe(cause);
  });

  it("should accept a non-Error cause", () => {
    const error = new AbstractError("wrapper", { cause: "string cause" });

    expect(error.cause).toBe("string cause");
  });

  it("should have a stack trace", () => {
    const error = new AbstractError("with stack");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("with stack");
  });

  it("should support nested cause chains", () => {
    const root = new AbstractError("root");
    const middle = new AbstractError("middle", { cause: root });
    const top = new AbstractError("top", { cause: middle });

    expect(top.cause).toBe(middle);
    expect((top.cause as AbstractError).cause).toBe(root);
  });
});

describe("consoleError", () => {
  it("should call console.error with a string argument", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleError("simple error message");

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("simple error message");
  });

  it("should call console.error with an Error argument", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("test error");

    consoleError(error);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("test error");
    expect(output).toContain("Error");
  });

  it("should call console.error with an AbstractError argument", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AbstractError("abstract error");

    consoleError(error);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("abstract error");
  });

  it("should format an Error with a cause chain", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new AbstractError("root cause");
    const error = new AbstractError("top level", { cause });

    consoleError(error);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("top level");
    expect(output).toContain("Caused by:");
    expect(output).toContain("root cause");
  });

  it("should handle backtick-wrapped code in string messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleError("Run `npm install` to fix");

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    // The backtick content should be transformed by replaceCode
    expect(output).not.toContain("`npm install`");
    expect(output).toContain("npm install");
  });

  it("should handle backtick-wrapped code in Error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Run `npm publish` first");

    consoleError(error);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain("`npm publish`");
    expect(output).toContain("npm publish");
  });

  it("should wrap output with leading and trailing newlines", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleError("test");

    const output = spy.mock.calls[0][0] as string;
    expect(output.startsWith("\n")).toBe(true);
    expect(output.endsWith("\n")).toBe(true);
  });

  it("should handle a non-string non-Error value cast to Error type", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Force a non-string, non-Error value through the function.
    // TypeScript prevents this, but at runtime it is possible.
    consoleError(42 as unknown as string);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("42");
  });

  it("should NOT include stack traces by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("stack test");

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toMatch(/\w+\.\w+:\d+:\d+/);
  });

  it("should include stack traces when DEBUG=pubm is set", () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = "pubm";
    try {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("debug test");
      consoleError(error);
      const output = spy.mock.calls[0][0] as string;
      expect(output).toMatch(/\w+\.\w+:\d+:\d+/);
    } finally {
      process.env.DEBUG = originalDebug;
    }
  });

  it("should format stderr blocks with gutter lines", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AbstractError(
      "Failed to run `cargo publish --dry-run`:\nerror: failed to prepare\n\nCaused by:\n  no matching package",
    );

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("Failed to run");
    expect(output).toContain("│");
    expect(output).toContain("error: failed to prepare");
  });

  it("should skip NonZeroExitError in cause chain", async () => {
    const { NonZeroExitError } = await import("../../src/utils/exec.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cause = new NonZeroExitError("cargo", 101, {
      stdout: "",
      stderr: "",
    });
    const error = new AbstractError("Failed to publish", { cause });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("Failed to publish");
    expect(output).not.toContain("Caused");
    expect(output).not.toContain("non-zero");
  });

  it("should skip generic non-zero child-process causes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("Process exited with non-zero status 1");
    const error = new AbstractError("Failed to publish", { cause });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("Failed to publish");
    expect(output).not.toContain("Caused by:");
  });

  it("should show cause chain when cause has meaningful info", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new AbstractError("network timeout");
    const error = new AbstractError("Failed to ping registry", { cause });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("Caused by:");
    expect(output).toContain("network timeout");
  });

  it("should skip cause when it has the same message as parent", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connection failed");
    const error = new AbstractError("connection failed", { cause });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain("Caused by:");
  });

  it("should render non-Error causes that still add context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new AbstractError("Registry request failed", {
      cause: 503,
    });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("Caused by:");
    expect(output).toContain("503");
  });

  it("should stringify malformed Error.message values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("ignored");

    Object.defineProperty(error, "message", {
      value: { detail: "structured failure" },
      configurable: true,
    });

    consoleError(error);

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("[object Object]");
  });

  it("should format deeply nested cause chains", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const level1 = new AbstractError("level 1");
    const level2 = new AbstractError("level 2", { cause: level1 });
    const level3 = new AbstractError("level 3", { cause: level2 });

    consoleError(level3);

    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("level 3");
    expect(output).toContain("level 2");
    expect(output).toContain("level 1");
  });
});
