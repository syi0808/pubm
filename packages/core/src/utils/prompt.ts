import { prompt as runnerPrompt } from "@pubm/runner";

export type PromptOptionValue = string | number | boolean;

export interface PromptChoice<T = PromptOptionValue> {
  name?: T;
  value?: T;
  message?: string;
  label?: string;
  hint?: string;
  disabled?: boolean | string;
}

export interface PromptOptions {
  type: string;
  message: string;
  choices?: PromptChoice[];
  options?: PromptChoice[];
  initial?: unknown;
  initialValue?: unknown;
  initialValues?: unknown[];
  placeholder?: string;
  footer?: string;
  enabled?: string;
  disabled?: string;
  required?: boolean;
  withGuide?: boolean;
  input?: unknown;
  output?: unknown;
  signal?: AbortSignal;
  validate?: (value: unknown) => string | Error | undefined | boolean;
  [key: string]: unknown;
}

export async function prompt<T = unknown>(options: PromptOptions): Promise<T> {
  return (runnerPrompt as (options: PromptOptions) => Promise<T>)(options);
}
