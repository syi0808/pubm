type Rollback<Ctx extends {}> = (ctx: Ctx) => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: generic rollback storage requires any
const rollbacks: { fn: Rollback<any>; ctx: unknown }[] = [];

export function addRollback<Ctx extends {}>(
  rollback: Rollback<Ctx>,
  context: Ctx,
): void {
  rollbacks.push({ fn: rollback, ctx: context });
}

let called = false;

export async function rollback(): Promise<void> {
  if (called) return void 0;

  called = true;

  if (rollbacks.length <= 0) return void 0;

  console.log("Rollback...");

  const results = await Promise.allSettled(
    rollbacks.map(({ fn, ctx }) => fn(ctx)),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `Rollback operation failed: ${failure.reason instanceof Error ? failure.reason.message : failure.reason}`,
      );
    }
    console.log(
      "Rollback completed with errors. Some operations may require manual recovery.",
    );
  } else {
    console.log("Rollback completed");
  }
}
