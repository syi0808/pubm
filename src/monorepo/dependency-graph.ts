export interface PackageNode {
	name: string;
	version: string;
	path: string;
	dependencies: Record<string, string>;
}

/**
 * Builds an adjacency list of internal dependencies only.
 * Each key is a package name, and the value is an array of internal package names it depends on.
 */
export function buildDependencyGraph(
	packages: PackageNode[],
): Map<string, string[]> {
	const packageNames = new Set(packages.map((pkg) => pkg.name));
	const graph = new Map<string, string[]>();

	for (const pkg of packages) {
		const internalDeps = Object.keys(pkg.dependencies).filter((dep) =>
			packageNames.has(dep),
		);
		graph.set(pkg.name, internalDeps);
	}

	return graph;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns packages in dependency order (dependencies first).
 * Throws an error if circular dependencies are detected.
 */
export function topologicalSort(graph: Map<string, string[]>): string[] {
	// Calculate in-degrees
	const inDegree = new Map<string, number>();
	for (const name of graph.keys()) {
		inDegree.set(name, 0);
	}

	for (const [, deps] of graph) {
		for (const dep of deps) {
			inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
		}
	}

	// Start with nodes that have no incoming edges
	const queue: string[] = [];
	for (const [name, degree] of inDegree) {
		if (degree === 0) {
			queue.push(name);
		}
	}

	const sorted: string[] = [];

	while (queue.length > 0) {
		const node = queue.shift() as string;
		sorted.push(node);

		for (const dep of graph.get(node) ?? []) {
			const newDegree = (inDegree.get(dep) ?? 0) - 1;
			inDegree.set(dep, newDegree);
			if (newDegree === 0) {
				queue.push(dep);
			}
		}
	}

	if (sorted.length !== graph.size) {
		throw new Error('Circular dependency detected');
	}

	// Reverse so that dependencies come before dependents
	return sorted.reverse();
}
