import { RustEcosystem } from "../ecosystem/rust.js";

export async function sortCratesByDependencyOrder(
  cratePaths: string[],
): Promise<string[]> {
  if (cratePaths.length <= 1) return cratePaths;

  const crateInfos = await Promise.all(
    cratePaths.map(async (cratePath) => {
      const eco = new RustEcosystem(cratePath);
      const name = await eco.packageName();
      const deps = await eco.dependencies();
      return { cratePath, name, deps };
    }),
  );

  const nameSet = new Set(crateInfos.map((c) => c.name));
  const nameToPath = new Map(crateInfos.map((c) => [c.name, c.cratePath]));

  // Build adjacency list: for each crate, track which internal crates it depends on
  const internalDeps = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const name of nameSet) {
    inDegree.set(name, 0);
  }

  for (const crate of crateInfos) {
    const filtered = crate.deps.filter((d) => nameSet.has(d));
    internalDeps.set(crate.name, filtered);
    // Each dependency edge: crate.name depends on dep → dep must come first
    // So dep has an outgoing edge to crate.name → increase inDegree of crate.name
    for (const _dep of filtered) {
      inDegree.set(crate.name, (inDegree.get(crate.name) ?? 0) + 1);
    }
  }

  // Kahn's algorithm: start with nodes that have no dependencies (inDegree 0)
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    sorted.push(current);

    // Find all crates that depend on `current` and decrement their inDegree
    for (const [name, deps] of internalDeps) {
      if (deps.includes(current)) {
        const newDegree = (inDegree.get(name) ?? 0) - 1;
        inDegree.set(name, newDegree);
        if (newDegree === 0) queue.push(name);
      }
    }
  }

  if (sorted.length !== nameSet.size) {
    throw new Error("Circular dependency detected among configured crates");
  }

  return sorted.map((name) => {
    const cratePath = nameToPath.get(name);
    if (cratePath === undefined) {
      throw new Error(`Missing crate path for ${name}`);
    }
    return cratePath;
  });
}
