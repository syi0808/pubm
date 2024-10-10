export function isScopedPackage(packageName: string) {
	return /^@[^/]+\/[^@][\w.-]*$/.test(packageName);
}

export function getScope(packageName: string) {
	return packageName.match(/^@([^/]+)/)?.[1];
}

export function getScopeAndName(packageName: string) {
	const matches = packageName.match(/^@([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)$/);
	const scope = matches?.[1];
	const name = matches?.[2];

	return [scope, name];
}
