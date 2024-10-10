import { Listr } from 'listr2';
import { rollback } from './rollback.js';

export function createListr<Context extends {}>(
	...args: ConstructorParameters<typeof Listr<Context>>
) {
	const listr = new Listr<Context>(...args);

	listr.isRoot = () => false;

	// externalSignalHandler with pnpm patch
	// we should make pr on listr2 for new option externalSignalHandler
	// @ts-ignore
	listr.externalSignalHandler = rollback;

	return listr;
}
