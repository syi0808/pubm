import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClackPromptProvider,
  PromptCancelledError,
  prompt,
  StaticPromptProvider,
} from "../../src/prompts.js";

const clack = vi.hoisted(() => ({
  cancel: Symbol("cancel"),
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === clack.cancel),
  multiselect: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: clack.confirm,
  isCancel: clack.isCancel,
  multiselect: clack.multiselect,
  password: clack.password,
  select: clack.select,
  text: clack.text,
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clack.confirm.mockReset();
  clack.isCancel.mockClear();
  clack.multiselect.mockReset();
  clack.password.mockReset();
  clack.select.mockReset();
  clack.text.mockReset();
});

const COMMON_PROMPT_OPTIONS = {
  input: undefined,
  output: undefined,
  signal: undefined,
  withGuide: false,
};

describe("ClackPromptProvider", () => {
  it("maps select, multiselect, confirm, password, and text prompts to clack", async () => {
    const provider = new ClackPromptProvider();
    const validate = vi.fn();

    clack.select.mockResolvedValueOnce("jsr");
    clack.multiselect.mockResolvedValueOnce(["npm", "jsr"]);
    clack.confirm.mockResolvedValueOnce(true);
    clack.password.mockResolvedValueOnce("secret");
    clack.text.mockResolvedValueOnce("pubm");

    await expect(
      provider.prompt({
        type: "select",
        message: "Registry",
        choices: [
          { name: "npm", message: "npm registry", hint: "classic" },
          { value: "jsr", label: "JSR", disabled: "not configured" },
        ],
        initial: 1,
      }),
    ).resolves.toBe("jsr");
    await expect(
      provider.prompt({
        type: "multi-select",
        message: "Registries",
        options: [
          { name: "npm", label: "npm" },
          { value: "jsr", label: "JSR" },
        ],
        initial: [0, "jsr"],
        required: true,
      }),
    ).resolves.toEqual(["npm", "jsr"]);
    await expect(
      provider.prompt({
        type: "confirm",
        message: "Continue?",
        enabled: "yes",
        disabled: "no",
        initial: true,
      }),
    ).resolves.toBe(true);
    await expect(
      provider.prompt({
        type: "invisible",
        message: "Token",
        footer: "Create a token at https://example.com/token",
        validate,
      }),
    ).resolves.toBe("secret");
    await expect(
      provider.prompt({
        type: "text",
        message: "Name",
        placeholder: "package",
        initialValue: "pubm",
        validate,
      }),
    ).resolves.toBe("pubm");

    expect(clack.select).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Registry",
      options: [
        {
          value: "npm",
          label: "npm registry",
          hint: "classic",
          disabled: undefined,
        },
        {
          value: "jsr",
          label: "JSR",
          hint: undefined,
          disabled: true,
        },
      ],
      initialValue: "jsr",
    });
    expect(clack.multiselect).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Registries",
      options: [
        { value: "npm", label: "npm", hint: undefined, disabled: undefined },
        { value: "jsr", label: "JSR", hint: undefined, disabled: undefined },
      ],
      initialValues: ["npm", "jsr"],
      required: true,
    });
    expect(clack.confirm).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Continue?",
      active: "yes",
      inactive: "no",
      initialValue: true,
    });
    expect(clack.password).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Token\nCreate a token at https://example.com/token",
      validate: expect.any(Function),
    });
    expect(clack.text).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Name",
      placeholder: "package",
      initialValue: "pubm",
      validate: expect.any(Function),
    });
    const passwordValidate = clack.password.mock.calls[0][0].validate;
    expect(passwordValidate("secret")).toBeUndefined();
    expect(validate).toHaveBeenCalledWith("secret");
  });

  it("normalizes fallback choice values and alternate initial option shapes", async () => {
    const provider = new ClackPromptProvider();

    clack.select.mockResolvedValueOnce("manual");
    clack.multiselect.mockResolvedValueOnce(["npm"]);
    clack.multiselect.mockResolvedValueOnce(["jsr"]);
    clack.confirm.mockResolvedValueOnce(false);
    clack.text.mockResolvedValueOnce("typed");

    await expect(
      provider.prompt({
        type: "select",
        message: "Fallback",
        choices: [
          { value: { id: 1 } as never, message: "Object value" },
          { value: { id: 2 } as never },
        ],
        initialValue: "manual",
      }),
    ).resolves.toBe("manual");
    await expect(
      provider.prompt({
        type: "multiselect",
        message: "Preset",
        choices: [{ name: "npm", label: "npm" }],
        initialValues: ["npm"],
      }),
    ).resolves.toEqual(["npm"]);
    await expect(
      provider.prompt({
        type: "multiselect",
        message: "No preset",
        choices: [{ name: "jsr", label: "JSR" }],
        initial: "jsr",
      }),
    ).resolves.toEqual(["jsr"]);
    await expect(
      provider.prompt({
        type: "toggle",
        message: "Continue?",
        initialValue: false,
      }),
    ).resolves.toBe(false);
    await expect(
      provider.prompt({
        type: "input",
        message: "Name",
        initial: "seed",
      }),
    ).resolves.toBe("typed");

    expect(clack.select).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Fallback",
      options: [
        {
          value: "Object value",
          label: "Object value",
          hint: undefined,
          disabled: undefined,
        },
        { value: "", label: undefined, hint: undefined, disabled: undefined },
      ],
      initialValue: "manual",
    });
    expect(clack.multiselect).toHaveBeenNthCalledWith(1, {
      ...COMMON_PROMPT_OPTIONS,
      message: "Preset",
      options: [
        { value: "npm", label: "npm", hint: undefined, disabled: undefined },
      ],
      initialValues: ["npm"],
      required: false,
    });
    expect(clack.multiselect).toHaveBeenNthCalledWith(2, {
      ...COMMON_PROMPT_OPTIONS,
      message: "No preset",
      options: [
        { value: "jsr", label: "JSR", hint: undefined, disabled: undefined },
      ],
      initialValues: undefined,
      required: false,
    });
    expect(clack.confirm).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Continue?",
      active: undefined,
      inactive: undefined,
      initialValue: false,
    });
    expect(clack.text).toHaveBeenCalledWith({
      ...COMMON_PROMPT_OPTIONS,
      message: "Name",
      placeholder: undefined,
      initialValue: "seed",
      validate: undefined,
    });
  });

  it("serializes prompts so only one clack prompt is active at a time", async () => {
    const provider = new ClackPromptProvider();
    const first = deferred<string>();
    const second = deferred<string>();

    clack.text
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstPrompt = provider.prompt({ type: "text", message: "First" });
    const secondPrompt = provider.prompt({ type: "text", message: "Second" });

    await vi.waitFor(() => expect(clack.text).toHaveBeenCalledTimes(1));

    first.resolve("one");
    await expect(firstPrompt).resolves.toBe("one");
    await vi.waitFor(() => expect(clack.text).toHaveBeenCalledTimes(2));

    second.resolve("two");
    await expect(secondPrompt).resolves.toBe("two");
  });

  it("throws PromptCancelledError when clack reports cancellation", async () => {
    const provider = new ClackPromptProvider();
    clack.confirm.mockResolvedValueOnce(clack.cancel);

    await expect(
      provider.prompt({ type: "confirm", message: "Continue?" }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it("normalizes legacy validation results for text prompts", async () => {
    const provider = new ClackPromptProvider();
    clack.text.mockResolvedValueOnce("release");

    await provider.prompt({
      type: "input",
      message: "Branch",
      validate: (value) => value === "release" || "Branch is required",
    });

    const validate = clack.text.mock.calls[0][0].validate;
    expect(validate("release")).toBeUndefined();
    expect(validate("")).toBe("Branch is required");

    await provider.prompt({
      type: "input",
      message: "Token",
      validate: () => false,
    });

    const falseValidate = clack.text.mock.calls[1][0].validate;
    expect(falseValidate("")).toBe("Invalid value.");
  });

  it("passes common clack options and normalizes Error validation results", async () => {
    const controller = new AbortController();
    const input = {};
    const output = {};

    clack.text.mockResolvedValueOnce("release");

    await expect(
      prompt({
        type: "text",
        message: "Branch",
        input,
        output,
        signal: controller.signal,
        withGuide: true,
        validate: () => new Error("Branch is required"),
      }),
    ).resolves.toBe("release");

    expect(clack.text).toHaveBeenCalledWith(
      expect.objectContaining({
        input,
        output,
        signal: controller.signal,
        withGuide: true,
      }),
    );
    const validate = clack.text.mock.calls[0][0].validate;
    expect(validate("main")).toBe("Branch is required");
  });
});

describe("StaticPromptProvider", () => {
  it("records prompt requests and returns queued responses", async () => {
    const provider = new StaticPromptProvider(["first", 2]);

    await expect(
      provider.prompt({ type: "text", message: "Name" }),
    ).resolves.toBe("first");
    await expect(
      provider.prompt({ type: "select", message: "Count" }),
    ).resolves.toBe(2);

    expect(provider.requests).toEqual([
      { type: "text", message: "Name" },
      { type: "select", message: "Count" },
    ]);
  });

  it("returns undefined when no static responses remain", async () => {
    const provider = new StaticPromptProvider();

    await expect(
      provider.prompt({ type: "text", message: "Name" }),
    ).resolves.toBeUndefined();
  });
});
