import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePatterns } from "./discover.js";
import { detectWorkspace } from "./workspace.js";

const WORKSPACE_PREFIX = "workspace:";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/**
 * Resolve a single workspace: protocol specifier to a concrete version string.
 * Follows pnpm/yarn/bun publish resolution rules.
 */
export function resolveWorkspaceProtocol(
  spec: string,
  version: string,
): string {
  if (!spec.startsWith(WORKSPACE_PREFIX)) return spec;

  const range = spec.slice(WORKSPACE_PREFIX.length);

  switch (range) {
    case "*":
      return version;
    case "^":
      return `^${version}`;
    case "~":
      return `~${version}`;
    default:
      return range;
  }
}

/** Dynamic workspace specifiers that require sibling version lookup */
function isDynamicWorkspaceSpec(range: string): boolean {
  return range === "*" || range === "^" || range === "~";
}

/**
 * Build a Map<packageName, version> for all workspace packages.
 * Uses cwd-based workspace discovery, not pubm config.
 */
export function collectWorkspaceVersions(cwd: string): Map<string, string> {
  const versions = new Map<string, string>();
  const workspaces = detectWorkspace(cwd);

  if (workspaces.length === 0) return versions;

  for (const workspace of workspaces) {
    if (workspace.patterns.length === 0) continue;

    const dirs = resolvePatterns(cwd, workspace.patterns);

    for (const dir of dirs) {
      const pkgJsonPath = join(dir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;

      try {
        const content = readFileSync(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(content);

        if (
          typeof pkg.name === "string" &&
          pkg.name &&
          typeof pkg.version === "string" &&
          pkg.version
        ) {
          versions.set(pkg.name, pkg.version);
        }
      } catch {
        // Malformed package.json — skip
      }
    }
  }

  return versions;
}

/**
 * Resolve workspace: protocols in package.json files.
 * Returns a Map<filePath, originalContent> for restoration.
 */
export function resolveWorkspaceProtocolsInManifests(
  packagePaths: string[],
  workspaceVersions: Map<string, string>,
): Map<string, string> {
  const backups = new Map<string, string>();

  for (const pkgPath of packagePaths) {
    const manifestPath = join(pkgPath, "package.json");
    const original = readFileSync(manifestPath, "utf-8");
    const pkg = JSON.parse(original);

    let modified = false;

    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;

      for (const [depName, spec] of Object.entries(deps)) {
        if (!spec.startsWith(WORKSPACE_PREFIX)) continue;

        const range = spec.slice(WORKSPACE_PREFIX.length);

        if (isDynamicWorkspaceSpec(range)) {
          const version = workspaceVersions.get(depName);
          if (!version) {
            throw new Error(
              `Cannot resolve "${spec}" for dependency "${depName}": package not found in workspace`,
            );
          }
          deps[depName] = resolveWorkspaceProtocol(spec, version);
        } else {
          deps[depName] = range;
        }

        modified = true;
      }
    }

    if (modified) {
      backups.set(manifestPath, original);
      writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    }
  }

  return backups;
}

/**
 * Restore original package.json files from backups.
 */
export function restoreManifests(backups: Map<string, string>): void {
  for (const [filePath, content] of backups) {
    writeFileSync(filePath, content, "utf-8");
  }
}
