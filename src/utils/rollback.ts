type Rollback<Ctx extends {}> = (ctx: Ctx) => Promise<unknown>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
const rollbacks: { fn: Rollback<any>; ctx: unknown }[] = [];

export function addRollback<Ctx extends {}>(
	rollback: Rollback<Ctx>,
	context: Ctx,
) {
	rollbacks.push({ fn: rollback, ctx: context });
}

let called = false;

export async function rollback() {
	if (called) return void 0;

	called = true;

	if (rollbacks.length <= 0) return void 0;

	console.log('Rollback...');

	await Promise.all(rollbacks.map(({ fn, ctx }) => fn(ctx)));

	console.log('Rollback completed');
}
