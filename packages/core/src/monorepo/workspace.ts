import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser/lib/esm/main.js";
import { parse as parseToml } from "smol-toml";
import { parse } from "yaml";

export interface WorkspaceInfo {
  type: "pnpm" | "npm" | "yarn" | "bun" | "cargo" | "deno";
  patterns: string[];
  exclude?: string[];
}

export function detectWorkspace(cwd?: string): WorkspaceInfo[] {
  const root = cwd ?? process.cwd();
  const workspaces: WorkspaceInfo[] = [];

  // 1. Check pnpm-workspace.yaml
  const pnpmWorkspacePath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, "utf-8");
    const parsed = parse(content);
    const packages: string[] = parsed?.packages ?? [];
    workspaces.push({ type: "pnpm", patterns: packages });
  }

  // 2. Check Cargo.toml [workspace]
  const cargoTomlPath = join(root, "Cargo.toml");
  if (existsSync(cargoTomlPath)) {
    const content = readFileSync(cargoTomlPath, "utf-8");
    try {
      const parsed = parseToml(content);
      const workspace = parsed.workspace as
        | { members?: string[]; exclude?: string[] }
        | undefined;
      if (workspace?.members && Array.isArray(workspace.members)) {
        workspaces.push({
          type: "cargo",
          patterns: workspace.members,
          ...(workspace.exclude?.length ? { exclude: workspace.exclude } : {}),
        });
      }
    } catch {
      // Invalid TOML or no workspace section
    }
  }

  // 3. Check deno.json / deno.jsonc
  for (const denoFile of ["deno.json", "deno.jsonc"]) {
    const denoPath = join(root, denoFile);
    if (existsSync(denoPath)) {
      const content = readFileSync(denoPath, "utf-8");
      try {
        const parsed = denoFile.endsWith(".jsonc")
          ? parseJsonc(content)
          : JSON.parse(content);
        if (Array.isArray(parsed?.workspace)) {
          const patterns = parsed.workspace.map((p: string) =>
            p.startsWith("./") ? p.slice(2) : p,
          );
          workspaces.push({ type: "deno", patterns });
        }
      } catch {
        // Invalid JSON/JSONC
      }
      break; // Only read one deno config
    }
  }

  // 4. Check package.json workspaces (skip if pnpm already found)
  if (!workspaces.some((w) => w.type === "pnpm")) {
    const packageJsonPath = join(root, "package.json");
    if (existsSync(packageJsonPath)) {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      if (pkg.workspaces) {
        const bunfigPath = join(root, "bunfig.toml");
        const isBun = existsSync(bunfigPath);

        if (Array.isArray(pkg.workspaces)) {
          workspaces.push({
            type: isBun ? "bun" : "npm",
            patterns: pkg.workspaces,
          });
        } else if (
          typeof pkg.workspaces === "object" &&
          Array.isArray(pkg.workspaces.packages)
        ) {
          workspaces.push({
            type: isBun ? "bun" : "yarn",
            patterns: pkg.workspaces.packages,
          });
        }
      }
    }
  }

  return workspaces;
}
