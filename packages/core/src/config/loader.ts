import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import type { PubmConfig } from "./types.js";

const CONFIG_FILES = [
  "pubm.config.ts",
  "pubm.config.mts",
  "pubm.config.cts",
  "pubm.config.js",
  "pubm.config.mjs",
  "pubm.config.cjs",
];

async function findConfigFile(cwd: string): Promise<string | null> {
  for (const file of CONFIG_FILES) {
    const filePath = path.join(cwd, file);
    try {
      if ((await stat(filePath)).isFile()) {
        return filePath;
      }
    } catch {}
  }
  return null;
}

function resolveModuleSpecifier(
  specifier: string,
  parentIdentifier: string,
): string {
  if (specifier.startsWith("file://")) {
    return specifier;
  }

  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return new URL(specifier, pathToFileURL(parentIdentifier)).href;
  }

  return specifier;
}

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<PubmConfig | null> {
  const configPath = await findConfigFile(cwd);
  if (!configPath) return null;

  const output = await Bun.build({
    entrypoints: [configPath],
    target: "bun",
    format: "esm",
    minify: true,
    external: [],
    packages: "bundle",
    splitting: false,
  });

  if (!output.success) {
    const errors = output.logs.map((log) => log.message).join("\n");
    throw new Error(`Failed to build config: ${errors}`);
  }

  const entrypoint = output.outputs.find((file) => file.kind === "entry-point");
  if (!entrypoint) {
    throw new Error(`Failed to build config: missing entrypoint output`);
  }

  const moduleCache = new Map<string, vm.Module>();
  const mod = new vm.SourceTextModule(await entrypoint.text(), {
    identifier: configPath,
    initializeImportMeta(meta) {
      const dir = path.dirname(configPath);
      Object.defineProperties(meta, {
        url: { value: pathToFileURL(configPath).href, configurable: true },
        dir: { value: dir, configurable: true },
        dirname: { value: dir, configurable: true },
        path: { value: configPath, configurable: true },
        filename: { value: configPath, configurable: true },
      });
    },
  });

  await mod.link(async (specifier, referencingModule) => {
    const resolvedSpecifier = resolveModuleSpecifier(
      specifier,
      referencingModule.identifier,
    );
    const cached = moduleCache.get(resolvedSpecifier);
    if (cached) {
      return cached;
    }

    const namespace = await import(resolvedSpecifier);
    const exportNames = Array.from(
      new Set(["default", ...Object.getOwnPropertyNames(namespace)]),
    );
    const linkedModule = new vm.SyntheticModule(
      exportNames,
      function setExports() {
        for (const exportName of exportNames) {
          this.setExport(
            exportName,
            namespace[exportName as keyof typeof namespace],
          );
        }
      },
      { identifier: resolvedSpecifier },
    );

    moduleCache.set(resolvedSpecifier, linkedModule);
    await linkedModule.link(async (nestedSpecifier) => {
      throw new Error(`Unexpected nested import: ${nestedSpecifier}`);
    });
    await linkedModule.evaluate();
    return linkedModule;
  });
  await mod.evaluate();

  const namespace = mod.namespace as { default?: PubmConfig } & PubmConfig;
  return namespace.default ?? namespace;
}
