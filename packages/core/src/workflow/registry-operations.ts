import process from "node:process";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import {
  type RegistryDescriptor,
  registryCatalog,
} from "../registry/catalog.js";
import { JsrClient } from "../registry/jsr.js";
import type { PackageRegistry } from "../registry/package-registry.js";
import { openUrl } from "../utils/open-url.js";
import { pathFromKey } from "../utils/package-key.js";
import { SecureStore } from "../utils/secure-store.js";
import { ui } from "../utils/ui.js";
import type {
  ReleaseOperation,
  ReleaseOperationContext,
} from "./release-operation.js";

class NpmAvailableError extends AbstractError {
  name = t("error.npm.unavailable");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

class JsrAvailableError extends AbstractError {
  name = t("error.jsr.unavailable");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

type NpmLikeRegistry = PackageRegistry & {
  publish(otp?: string, tag?: string): Promise<boolean>;
  publishProvenance(tag?: string): Promise<boolean>;
  dryRunPublish(tag?: string): Promise<void>;
};

type JsrLikeRegistry = PackageRegistry & {
  packageCreationUrls?: string[];
};

type PublishWithTag = (tag?: string) => Promise<boolean>;
type DryRunWithTag = (tag?: string) => Promise<void>;

const AUTH_ERROR_PATTERNS = [
  /401/i,
  /403/i,
  /unauthorized/i,
  /forbidden/i,
  /invalid.token/i,
  /eotp/i,
];

const MISSING_CRATE_PATTERN = /no matching package named `([^`]+)` found/;
const VERSION_MISMATCH_PATTERN =
  /failed to select a version for the requirement `([^=`\s]+)/;

export function createRegistryPublishOperation(
  registryKey: string,
  packageKey: string,
): ReleaseOperation {
  const packagePath = pathFromKey(packageKey);

  return {
    title: packagePath,
    run: async (ctx, operation): Promise<void> => {
      const { descriptor, registry } = await createRegistry(
        registryKey,
        packageKey,
      );

      operation.title = registry.packageName || packagePath;

      if (
        await skipPublishedVersion(ctx, operation, registry, packageKey, {
          registryKey,
        })
      ) {
        return;
      }

      if (isJsrRegistry(registryKey, registry)) {
        await publishJsr(
          ctx,
          operation,
          registry as JsrLikeRegistry,
          packageKey,
        );
        return;
      }

      if (isCratesRegistry(registryKey, registry)) {
        await publishCrates(ctx, operation, descriptor, registry, packageKey);
        return;
      }

      if (isNpmLikeRegistry(registry)) {
        await publishNpm(ctx, operation, descriptor, registry, packageKey);
        return;
      }

      await publishGeneric(ctx, operation, descriptor, registry, packageKey);
    },
  };
}

export function createRegistryDryRunOperation(
  registryKey: string,
  packageKey: string,
  siblingKeys?: string[],
): ReleaseOperation {
  const packagePath = pathFromKey(packageKey);

  return {
    title:
      registryKey === "crates"
        ? t("task.dryRun.crates.title", { path: packagePath })
        : packagePath,
    run: async (ctx, operation): Promise<void> => {
      const { descriptor, registry } = await createRegistry(
        registryKey,
        packageKey,
      );

      operation.title = dryRunTitle(registryKey, registry, packagePath);

      if (
        await skipPublishedVersion(ctx, operation, registry, packageKey, {
          registryKey,
          dryRun: true,
        })
      ) {
        return;
      }

      if (isCratesRegistry(registryKey, registry)) {
        await dryRunCrates(
          ctx,
          operation,
          descriptor,
          registry,
          packageKey,
          siblingKeys,
        );
        return;
      }

      await dryRunRegistry(ctx, operation, descriptor, registry, registryKey);
    },
  };
}

async function createRegistry(
  registryKey: string,
  packageKey: string,
): Promise<{ descriptor: RegistryDescriptor; registry: PackageRegistry }> {
  const descriptor = registryCatalog.get(registryKey);
  if (!descriptor) {
    throw new Error(
      `No registry descriptor registered for registry "${registryKey}". Cannot publish "${packageKey}".`,
    );
  }

  const registry = await descriptor.factory(pathFromKey(packageKey));
  if (!registry) {
    throw new Error(
      `Registry "${registryKey}" factory did not return a package registry for "${packageKey}".`,
    );
  }

  return { descriptor, registry };
}

function isNpmLikeRegistry(
  registry: PackageRegistry,
): registry is NpmLikeRegistry {
  return (
    typeof (registry as Partial<NpmLikeRegistry>).publishProvenance ===
    "function"
  );
}

function isJsrRegistry(
  registryKey: string,
  _registry: PackageRegistry,
): boolean {
  return registryKey === "jsr";
}

function isCratesRegistry(
  registryKey: string,
  _registry: PackageRegistry,
): boolean {
  return registryKey === "crates";
}

function dryRunTitle(
  registryKey: string,
  registry: PackageRegistry,
  packagePath: string,
): string {
  if (isCratesRegistry(registryKey, registry)) {
    return t("task.dryRun.crates.title", { path: packagePath });
  }
  return registry.packageName || packagePath;
}

async function skipPublishedVersion(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  registry: PackageRegistry,
  packageKey: string,
  options: { dryRun?: boolean; registryKey?: string } = {},
): Promise<boolean> {
  const version = getPackageVersion(ctx, packageKey);
  if (!(await registry.isVersionPublished(version))) return false;

  markAlreadyPublishedSkip(operation, registry, packageKey, version, options);
  return true;
}

function markAlreadyPublishedSkip(
  operation: ReleaseOperationContext,
  registry: PackageRegistry,
  packageKey: string,
  version: string,
  options: { dryRun?: boolean; registryKey?: string } = {},
): void {
  const packagePath = pathFromKey(packageKey);

  if (isCratesRegistry(options.registryKey ?? "", registry)) {
    operation.title = t(
      options.dryRun ? "task.dryRun.crates.skipped" : "task.crates.skipped",
      { path: packagePath, version },
    );
    operation.output = t("task.crates.alreadyPublished", {
      name: registry.packageName,
      version,
    });
    operation.skip();
    return;
  }

  if (isJsrRegistry(options.registryKey ?? "", registry)) {
    operation.title = t(
      options.dryRun ? "task.dryRun.jsr.skipped" : "task.jsr.skipped",
      { version },
    );
    operation.output = t("task.jsr.alreadyPublished", {
      name: registry.packageName,
      version,
    });
    operation.skip();
    return;
  }

  if (isNpmLikeRegistry(registry)) {
    operation.title = t(
      options.dryRun ? "task.dryRun.npm.skipped" : "task.npm.skipped",
      { version },
    );
    operation.output = t("task.npm.alreadyPublished", {
      name: registry.packageName,
      version,
    });
    operation.skip();
    return;
  }

  operation.title = `[SKIPPED] ${registry.packageName}: v${version} already published`;
  operation.output = `${registry.packageName}@${version} is already published`;
  operation.skip();
}

async function publishNpm(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  descriptor: RegistryDescriptor,
  registry: NpmLikeRegistry,
  packageKey: string,
): Promise<void> {
  const version = getPackageVersion(ctx, packageKey);
  operation.output = t("task.npm.publishing");

  try {
    if (ctx.runtime.promptEnabled) {
      await publishNpmWithOtp(ctx, operation, registry);
    } else {
      await publishNpmInCi(ctx, descriptor, registry);
    }
  } catch (error) {
    if (isNpmAlreadyPublishedError(error)) {
      markAlreadyPublishedSkip(operation, registry, packageKey, version);
      return;
    }
    throw error;
  }

  registerNpmRollback(ctx, descriptor, registry, version);
}

async function publishNpmWithOtp(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  registry: NpmLikeRegistry,
): Promise<void> {
  const result = await registry.publish(ctx.runtime.npmOtp, ctx.runtime.tag);
  if (result) return;

  let isOtpCreator = false;
  if (!ctx.runtime.npmOtpPromise) {
    isOtpCreator = true;
    ctx.runtime.npmOtpPromise = (async () => {
      operation.title = t("task.npm.otpTitle", {
        name: registry.packageName,
      });
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const otp = await operation.prompt().run<string>({
          type: "password",
          message: t("prompt.npm.otp", {
            attempt:
              attempt > 1
                ? t("prompt.npm.otpAttempt", {
                    current: attempt,
                    max: maxAttempts,
                  })
                : "",
          }),
        });

        const success = await registry.publish(otp, ctx.runtime.tag);
        if (success) {
          ctx.runtime.npmOtp = otp;
          operation.title = t("task.npm.otpPassed", {
            name: registry.packageName,
          });
          return otp;
        }

        if (attempt < maxAttempts) {
          operation.output = t("task.npm.otpFailed");
        }
      }

      throw new NpmAvailableError(t("error.npm.otpFailed"));
    })();
  }

  const otp = await ctx.runtime.npmOtpPromise;
  if (!isOtpCreator) {
    await registry.publish(otp, ctx.runtime.tag);
  }
}

async function publishNpmInCi(
  ctx: PubmContext,
  descriptor: RegistryDescriptor,
  registry: NpmLikeRegistry,
): Promise<void> {
  const envVar = descriptor.tokenConfig.envVar || "NODE_AUTH_TOKEN";
  if (!process.env[envVar]) {
    throw new NpmAvailableError(
      envVar === "NODE_AUTH_TOKEN"
        ? t("error.npm.noAuthToken")
        : `${envVar} not found in environment variables.`,
    );
  }

  const result = await registry.publishProvenance(ctx.runtime.tag);
  if (!result) {
    throw new NpmAvailableError(
      t("error.npm.2faInCi", { name: registry.packageName }),
    );
  }
}

async function publishJsr(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  registry: JsrLikeRegistry,
  packageKey: string,
): Promise<void> {
  const version = getPackageVersion(ctx, packageKey);
  operation.output = t("task.jsr.publishing");

  try {
    if (!JsrClient.token && !ctx.runtime.promptEnabled) {
      const jsrTokenEnv = process.env.JSR_TOKEN;
      if (!jsrTokenEnv) {
        throw new JsrAvailableError(t("error.jsr.noToken"));
      }
      JsrClient.token = jsrTokenEnv;
    }

    let result = await publishWithTag(registry, ctx.runtime.tag);

    if (!result && registry.packageCreationUrls) {
      if (!ctx.runtime.promptEnabled) {
        throw new JsrAvailableError(
          t("task.jsr.createPackage", {
            urls: registry.packageCreationUrls.join("\n"),
          }),
        );
      }

      result = await completeJsrPackageCreation(
        operation,
        registry,
        ctx.runtime.tag,
      );
    }

    if (!result) {
      throw new JsrAvailableError(t("error.jsr.creationFailed"));
    }
  } catch (error) {
    if (isJsrAlreadyPublishedError(error)) {
      operation.title = t("task.jsr.skipped", { version });
      operation.output = t("task.jsr.alreadyPublished", {
        name: registry.packageName,
        version,
      });
      operation.skip();
      return;
    }
    throw error;
  }
}

async function completeJsrPackageCreation(
  operation: ReleaseOperationContext,
  registry: JsrLikeRegistry,
  tag: string | undefined,
): Promise<boolean> {
  const urls = registry.packageCreationUrls;
  if (!urls?.length) return false;

  operation.title = t("task.jsr.packageCreation");
  operation.output = t("task.jsr.createPackage", {
    urls: urls.map((url) => `  ${ui.chalk.cyan(url)}`).join("\n"),
  });

  void openUrl(urls[0]);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await operation.prompt().run<string>({
      type: "input",
      message: t("prompt.jsr.pressEnter", {
        key: ui.chalk.bold("enter"),
        attempt: attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "",
      }),
    });

    const result = await publishWithTag(registry, tag);
    if (result) {
      operation.title = t("task.jsr.packageCreated");
      return true;
    }

    if (attempt < maxAttempts) {
      operation.output = t("task.jsr.stillNotExists");
    }
  }

  throw new JsrAvailableError(t("error.jsr.creationFailed"));
}

async function publishCrates(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  packageKey: string,
): Promise<void> {
  const packagePath = pathFromKey(packageKey);
  const version = getPackageVersion(ctx, packageKey);

  try {
    operation.output = t("task.crates.publishingVersion", {
      name: registry.packageName,
      version,
    });
    await publishWithTag(registry, ctx.runtime.tag);
  } catch (error) {
    if (isCratesAlreadyUploadedError(error)) {
      markAlreadyPublishedSkip(operation, registry, packageKey, version, {
        registryKey: descriptor.key,
      });
      return;
    }
    throw error;
  }

  operation.title = t("task.crates.publishing", { path: packagePath });
  registerCratesRollback(ctx, descriptor, registry, version);
}

async function publishGeneric(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  packageKey: string,
): Promise<void> {
  const version = getPackageVersion(ctx, packageKey);

  try {
    const result = await publishWithTag(registry, ctx.runtime.tag);
    if (!result) {
      throw new Error(
        `${descriptor.label} publish did not complete for ${registry.packageName}.`,
      );
    }
  } catch (error) {
    if (isGenericAlreadyPublishedError(error)) {
      markAlreadyPublishedSkip(operation, registry, packageKey, version);
      return;
    }
    throw error;
  }

  registerGenericRollback(ctx, descriptor, registry, version);
}

function registerNpmRollback(
  ctx: PubmContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  version: string,
): void {
  if (!registry.supportsUnpublish) return;

  const canUnpublish =
    ctx.runtime.promptEnabled || ctx.config.rollback.dangerouslyAllowUnpublish;
  const verb = descriptor.unpublishLabel ?? "Unpublish";

  if (!canUnpublish) {
    ctx.runtime.rollback.add({
      label: t("task.npm.rollbackSkipped", {
        verb,
        name: registry.packageName,
        version,
      }),
      fn: async () => {},
    });
    return;
  }

  ctx.runtime.rollback.add({
    label: t("task.npm.rollbackBurned", {
      verb,
      name: registry.packageName,
      version,
    }),
    fn: async () => {
      await registry.unpublish(registry.packageName, version);
      console.log(
        `    ${ui.chalk.yellow("\u26a0")} ${t("task.npm.versionReserved", { version })}`,
      );
    },
    confirm: true,
  });
}

function registerCratesRollback(
  ctx: PubmContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  version: string,
): void {
  if (!registry.supportsUnpublish) return;

  const canYank =
    ctx.runtime.promptEnabled || ctx.config.rollback.dangerouslyAllowUnpublish;
  const verb = descriptor.unpublishLabel ?? "Yank";

  if (!canYank) {
    ctx.runtime.rollback.add({
      label: t("task.crates.rollbackSkipped", {
        verb,
        name: registry.packageName,
        version,
      }),
      fn: async () => {},
    });
    return;
  }

  ctx.runtime.rollback.add({
    label: t("task.crates.rollbackBurned", {
      verb,
      name: registry.packageName,
      version,
    }),
    fn: async () => {
      await registry.unpublish(registry.packageName, version);
      console.log(
        `    ${ui.chalk.yellow("\u26a0")} ${t("task.crates.versionReserved", { version })}`,
      );
    },
    confirm: true,
  });
}

function registerGenericRollback(
  ctx: PubmContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  version: string,
): void {
  if (!registry.supportsUnpublish) return;

  const canUnpublish =
    ctx.runtime.promptEnabled || ctx.config.rollback.dangerouslyAllowUnpublish;
  const verb = descriptor.unpublishLabel ?? "Unpublish";
  const label = `${verb} ${registry.packageName}@${version} from ${descriptor.label}`;

  if (!canUnpublish) {
    ctx.runtime.rollback.add({
      label: `${label} (skipped - use --dangerously-allow-unpublish to enable)`,
      fn: async () => {},
    });
    return;
  }

  ctx.runtime.rollback.add({
    label,
    fn: async () => {
      await registry.unpublish(registry.packageName, version);
    },
    confirm: true,
  });
}

async function dryRunRegistry(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  registryKey: string,
): Promise<void> {
  if (isJsrRegistry(registryKey, registry)) {
    operation.output = t("task.dryRun.jsr.running");
    await withTokenRetry(registryKey, descriptor, ctx, operation, async () => {
      await dryRunWithTag(registry, ctx.runtime.tag);
    });
    return;
  }

  if (isNpmLikeRegistry(registry)) {
    operation.output = t("task.dryRun.npm.running");
    await withTokenRetry(registryKey, descriptor, ctx, operation, async () => {
      await registry.dryRunPublish(ctx.runtime.tag);
    });
    return;
  }

  operation.output = `Running ${descriptor.label} dry-run publish...`;
  await withTokenRetry(registryKey, descriptor, ctx, operation, async () => {
    await dryRunWithTag(registry, ctx.runtime.tag);
  });
}

async function dryRunCrates(
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  descriptor: RegistryDescriptor,
  registry: PackageRegistry,
  packageKey: string,
  siblingKeys?: string[],
): Promise<void> {
  const packagePath = pathFromKey(packageKey);

  if (siblingKeys?.length) {
    const unpublished = await findUnpublishedSiblingDeps(
      packagePath,
      siblingKeys,
      ctx,
    );
    if (unpublished.length > 0) {
      operation.title = t("task.dryRun.crates.skippedSibling", {
        path: packagePath,
        crate: unpublished.join("`, `"),
      });
      return;
    }
  }

  operation.output = t("task.dryRun.crates.running");
  try {
    await withTokenRetry("crates", descriptor, ctx, operation, async () => {
      await dryRunWithTag(registry, ctx.runtime.tag);
    });
  } catch (error) {
    const crateName = siblingCrateFromDryRunError(error);
    if (crateName && siblingKeys) {
      const siblingNames = await Promise.all(
        siblingKeys.map((key) => getCrateName(pathFromKey(key))),
      );
      if (siblingNames.includes(crateName)) {
        operation.title = t("task.dryRun.crates.skippedSibling", {
          path: packagePath,
          crate: crateName,
        });
        return;
      }
    }
    throw error;
  }
}

function siblingCrateFromDryRunError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const missingMatch = message.match(MISSING_CRATE_PATTERN);
  const versionMatch = message.match(VERSION_MISMATCH_PATTERN);
  return missingMatch?.[1] ?? versionMatch?.[1]?.trim();
}

function publishWithTag(
  registry: PackageRegistry,
  tag: string | undefined,
): Promise<boolean> {
  return (registry.publish as PublishWithTag)(tag);
}

function dryRunWithTag(
  registry: PackageRegistry,
  tag: string | undefined,
): Promise<void> {
  return (registry.dryRunPublish as DryRunWithTag)(tag);
}

async function getCrateName(packagePath: string): Promise<string> {
  const eco = new RustEcosystem(packagePath);
  return await eco.packageName();
}

async function findUnpublishedSiblingDeps(
  packagePath: string,
  siblingKeys: string[],
  ctx: PubmContext,
): Promise<string[]> {
  const eco = new RustEcosystem(packagePath);
  const deps = await eco.dependencies();

  const siblingNameToKey = new Map<string, string>();
  await Promise.all(
    siblingKeys.map(async (key) => {
      const name = await getCrateName(pathFromKey(key));
      siblingNameToKey.set(name, key);
    }),
  );

  const siblingDeps = deps.filter((dep) => siblingNameToKey.has(dep));
  const results = await Promise.all(
    siblingDeps.map(async (name) => {
      const siblingKey = siblingNameToKey.get(name);
      if (!siblingKey) {
        throw new Error(`Missing sibling crate key for dependency: ${name}`);
      }

      const siblingPath = pathFromKey(siblingKey);
      const descriptor = registryCatalog.get("crates");
      if (!descriptor) {
        throw new Error("No registry descriptor registered for crates.");
      }
      const registry = await descriptor.factory(siblingPath);
      const version = getPackageVersion(ctx, siblingKey);

      if (version) {
        const versionPublished = await registry.isVersionPublished(version);
        return versionPublished ? null : name;
      }

      const published = await registry.isPublished();
      return published ? null : name;
    }),
  );

  return results.filter((name): name is string => name !== null);
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function withTokenRetry(
  registryKey: string,
  descriptor: RegistryDescriptor,
  ctx: PubmContext,
  operation: ReleaseOperationContext,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isAuthError(error)) throw error;

    const config = descriptor.tokenConfig;
    const retryPromises = ctx.runtime.tokenRetryPromises ?? {};
    ctx.runtime.tokenRetryPromises = retryPromises;

    if (!retryPromises[registryKey]) {
      retryPromises[registryKey] = (async () => {
        operation.output = t("task.preflight.authFailed", {
          label: config.promptLabel,
        });
        if (!ctx.runtime.promptEnabled) {
          throw error;
        }

        const newToken = await operation.prompt().run<string>({
          type: "password",
          message: t("prompt.preflight.reenter", {
            label: config.promptLabel,
          }),
        });
        new SecureStore().set(config.dbKey, newToken);
        process.env[config.envVar] = newToken;
        if (registryKey === "jsr") {
          JsrClient.token = newToken;
        }
        return newToken;
      })();
    }

    await retryPromises[registryKey];
    await action();
  }
}

function isNpmAlreadyPublishedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("cannot publish over the previously published") ||
    error.message.includes("You cannot publish over the previously published")
  );
}

function isJsrAlreadyPublishedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already published");
}

function isCratesAlreadyUploadedError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("is already uploaded")
  );
}

function isGenericAlreadyPublishedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /already (published|uploaded)|previously published/i.test(error.message)
  );
}
