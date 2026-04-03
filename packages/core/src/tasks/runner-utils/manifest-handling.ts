import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { runAssetPipeline } from "../../assets/pipeline.js";
import { normalizeConfig, resolveAssets } from "../../assets/resolver.js";
import type { PreparedAsset } from "../../assets/types.js";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { collectWorkspaceVersions } from "../../monorepo/resolve-workspace.js";
import { requirePackageEcosystem } from "./rollback-handlers.js";
import { writeVersions } from "./write-versions.js";

export async function prepareReleaseAssets(
  ctx: PubmContext,
  packageName: string,
  version: string,
  packagePath?: string,
): Promise<{ assets: PreparedAsset[]; tempDir: string }> {
  const assetConfig = ctx.config.releaseAssets ?? [];
  if (assetConfig.length === 0) {
    return { assets: [], tempDir: "" };
  }

  const assetHooks = ctx.runtime.pluginRunner.collectAssetHooks();
  const normalizedGroups = normalizeConfig(assetConfig, ctx.config.compress);

  // Find relevant group for this package: prefer package-specific match,
  // fall back to the first global (no packagePath) group only if none found.
  const relevantGroup = normalizedGroups.find(
    (g) => g.packagePath === packagePath,
  ) ??
    normalizedGroups.find((g) => !g.packagePath) ?? { files: [] };

  const tempDir = join(tmpdir(), `pubm-assets-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  ctx.runtime.tempDir = tempDir;

  const resolvedAssets = resolveAssets(
    relevantGroup,
    ctx.config.compress,
    ctx.cwd,
  );
  const preparedAssets = await runAssetPipeline(resolvedAssets, assetHooks, {
    name: packageName.replace(/^@[^/]+\//, ""),
    version,
    tempDir,
    pubmContext: ctx,
  });

  return { assets: preparedAssets, tempDir };
}

export async function resolveWorkspaceProtocols(
  ctx: PubmContext,
): Promise<void> {
  if (!ctx.cwd) return;

  const workspaceVersions = collectWorkspaceVersions(ctx.cwd);
  if (workspaceVersions.size === 0) return;

  const allBackups = new Map<string, string>();

  for (const pkg of ctx.config.packages) {
    const absPath = path.resolve(ctx.cwd, pkg.path);
    const ecosystem = requirePackageEcosystem(pkg);
    const descriptor = ecosystemCatalog.get(ecosystem);
    if (!descriptor) continue;

    const eco = new descriptor.ecosystemClass(absPath);
    const backups = await eco.resolvePublishDependencies(workspaceVersions);
    for (const [k, v] of backups) {
      allBackups.set(k, v);
    }
  }

  if (allBackups.size > 0) {
    ctx.runtime.workspaceBackups = allBackups;
    ctx.runtime.rollback.add({
      label: "Restore workspace protocol dependencies",
      fn: async () => {
        for (const [filePath, content] of allBackups) {
          writeFileSync(filePath, content, "utf-8");
        }
      },
    });
  }
}

export async function applyVersionsForDryRun(ctx: PubmContext): Promise<void> {
  const plan = ctx.runtime.versionPlan;
  if (!plan) return;

  // Backup original versions from config (safe: writeVersions not yet called in dry-run)
  ctx.runtime.dryRunVersionBackup = new Map(
    ctx.config.packages.map((pkg) => [pkg.path, pkg.version ?? "0.0.0"]),
  );

  // Build new versions map from versionPlan
  let newVersions: Map<string, string>;
  if (plan.mode === "single") {
    newVersions = new Map(
      ctx.config.packages.map((pkg) => [pkg.path, plan.version]),
    );
  } else {
    // fixed and independent both use plan.packages
    newVersions = plan.packages;
  }

  await writeVersions(ctx, newVersions);
}
