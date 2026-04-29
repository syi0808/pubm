import {
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
} from "@clack/prompts";
import type {
  PromptChoice,
  PromptOptions,
  PromptOptionValue,
  PromptProvider,
} from "./types.js";

export class PromptCancelledError extends Error {
  name = "PromptCancelledError";

  constructor() {
    super("Prompt cancelled.");
  }
}

class PromptMutex {
  private tail: Promise<unknown> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function choiceValue(choice: PromptChoice): PromptOptionValue {
  const value = choice.value ?? choice.name;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(choice.label ?? choice.message ?? "");
}

function choiceLabel(choice: PromptChoice): string | undefined {
  return choice.label ?? choice.message;
}

function choices(options: PromptOptions) {
  return options.options ?? options.choices ?? [];
}

function mapChoices(options: PromptOptions) {
  return choices(options).map((choice) => ({
    value: choiceValue(choice),
    label: choiceLabel(choice),
    hint: choice.hint,
    disabled: choice.disabled ? true : undefined,
  }));
}

function initialValue(options: PromptOptions): unknown {
  if (options.initialValue !== undefined) return options.initialValue;
  if (typeof options.initial === "number") {
    return mapChoices(options)[options.initial]?.value;
  }
  return options.initial;
}

function initialValues(options: PromptOptions): unknown[] | undefined {
  if (options.initialValues) return options.initialValues;
  if (!Array.isArray(options.initial)) return undefined;
  const mapped = mapChoices(options);
  return options.initial.map((value) =>
    typeof value === "number" ? mapped[value]?.value : value,
  );
}

function normalizeType(type: string): string {
  return type.toLowerCase();
}

function messageWithFooter(options: PromptOptions): string {
  return options.footer
    ? `${options.message}\n${options.footer}`
    : options.message;
}

function unwrapCancel<T>(value: T | symbol): T {
  if (isCancel(value)) throw new PromptCancelledError();
  return value;
}

function normalizeValidationResult(
  value: string | Error | undefined | boolean,
): string | undefined {
  if (value === true || value === undefined) return undefined;
  if (value === false) return "Invalid value.";
  if (value instanceof Error) return value.message;
  return value;
}

function stringValidator(options: PromptOptions) {
  if (!options.validate) return undefined;
  return (value: string | undefined): string | undefined =>
    normalizeValidationResult(options.validate?.(value));
}

function commonOptions(options: PromptOptions) {
  return {
    input: options.input as never,
    output: options.output as never,
    signal: options.signal as AbortSignal | undefined,
    withGuide:
      typeof options.withGuide === "boolean" ? options.withGuide : false,
  };
}

export class ClackPromptProvider implements PromptProvider {
  private readonly mutex = new PromptMutex();

  async prompt<T = unknown>(options: PromptOptions): Promise<T> {
    return this.mutex.run(async () => {
      const type = normalizeType(options.type);
      let result: unknown;

      if (type === "password" || type === "invisible") {
        result = unwrapCancel(
          await password({
            ...commonOptions(options),
            message: messageWithFooter(options),
            validate: stringValidator(options),
          }),
        );
      } else if (type === "select") {
        result = unwrapCancel(
          await select({
            ...commonOptions(options),
            message: messageWithFooter(options),
            options: mapChoices(options) as never,
            initialValue: initialValue(options) as never,
          }),
        );
      } else if (type === "multiselect" || type === "multi-select") {
        result = unwrapCancel(
          await multiselect({
            ...commonOptions(options),
            message: messageWithFooter(options),
            options: mapChoices(options) as never,
            initialValues: initialValues(options) as never[] | undefined,
            required: options.required ?? false,
          }),
        );
      } else if (type === "toggle" || type === "confirm") {
        result = unwrapCancel(
          await confirm({
            ...commonOptions(options),
            message: messageWithFooter(options),
            active: options.enabled,
            inactive: options.disabled,
            initialValue:
              typeof options.initial === "boolean"
                ? options.initial
                : (options.initialValue as boolean | undefined),
          }),
        );
      } else {
        result = unwrapCancel(
          await text({
            ...commonOptions(options),
            message: messageWithFooter(options),
            placeholder: options.placeholder,
            initialValue:
              typeof options.initial === "string"
                ? options.initial
                : (options.initialValue as string | undefined),
            validate: stringValidator(options),
          }),
        );
      }

      return result as T;
    });
  }
}

const defaultPromptProvider = new ClackPromptProvider();

export async function prompt<T = unknown>(options: PromptOptions): Promise<T> {
  return defaultPromptProvider.prompt<T>(options);
}

export class StaticPromptProvider implements PromptProvider {
  readonly requests: PromptOptions[] = [];
  private readonly responses: unknown[];

  constructor(responses: unknown[] = []) {
    this.responses = [...responses];
  }

  async prompt<T = unknown>(options: PromptOptions): Promise<T> {
    this.requests.push(options);
    return this.responses.shift() as T;
  }
}
