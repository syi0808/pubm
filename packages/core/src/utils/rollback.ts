import { color } from "listr2";

type Rollback<Ctx extends {}> = (ctx: Ctx) => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: generic rollback storage requires any
const rollbacks: { fn: Rollback<any>; ctx: unknown }[] = [];

export function addRollback<Ctx extends {}>(
  rollback: Rollback<Ctx>,
  context: Ctx,
): void {
  rollbacks.push({ fn: rollback, ctx: context });
}

export function rollbackLog(message: string): void {
  console.log(`  ${color.yellow("↩")} ${message}`);
}

export function rollbackError(message: string): void {
  console.error(`  ${color.red("✗")} ${message}`);
}

let called = false;

export async function rollback(): Promise<void> {
  if (called) return void 0;

  called = true;

  if (rollbacks.length <= 0) return void 0;

  console.log(`\n${color.yellow("⟲")} ${color.yellow("Rolling back...")}`);

  const results = await Promise.allSettled(
    rollbacks.map(({ fn, ctx }) => fn(ctx)),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      rollbackError(
        failure.reason instanceof Error
          ? failure.reason.message
          : failure.reason,
      );
    }
    console.log(
      `${color.red("✗")} ${color.red("Rollback completed with errors.")} Some operations may require manual recovery.`,
    );
  } else {
    console.log(`${color.green("✓")} Rollback completed`);
  }
}
