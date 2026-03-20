import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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

interface BuildLog {
  message: string;
  importKind?: string;
  specifier?: string;
  position?: {
    file?: string;
  } | null;
}

interface BuildOutputFile {
  kind: string;
  text(): Promise<string>;
}

type BuildFormat = "esm" | "cjs";

interface ConfigBuildResult {
  success: boolean;
  logs: BuildLog[];
  optionalDependencies: string[];
  outputs: BuildOutputFile[];
}

interface PackageManifest {
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const OPTIONAL_DEPENDENCY_NAMESPACE = "pubm-optional-dependency";
const CONFIG_MODULE_NAMESPACE = "pubm-config-module-shim";
const CONFIG_MODULE_SHIMS = {
  "vitest/config": [
    "function isObject(value) {",
    '  return value != null && typeof value === "object" && !Array.isArray(value);',
    "}",
    "",
    "export function mergeConfig(base, overrides) {",
    "  if (Array.isArray(base) && Array.isArray(overrides)) {",
    "    return [...base, ...overrides];",
    "  }",
    "",
    "  if (isObject(base) && isObject(overrides)) {",
    "    const merged = { ...base };",
    "    for (const [key, value] of Object.entries(overrides)) {",
    "      merged[key] = key in merged ? mergeConfig(merged[key], value) : value;",
    "    }",
    "    return merged;",
    "  }",
    "",
    "  return overrides === undefined ? base : overrides;",
    "}",
    "",
    "export function defineConfig(config) {",
    "  return config;",
    "}",
    "",
    "export const defineProject = defineConfig;",
    "export const defineWorkspace = defineConfig;",
    "export const configDefaults = {};",
    "export const coverageConfigDefaults = {};",
    "export const defaultBrowserPort = 63315;",
    "export const defaultExclude = [];",
    "export const defaultInclude = [];",
    "export const extraInlineDeps = [];",
    "export default defineConfig;",
  ].join("\n"),
} as const satisfies Record<string, string>;

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

function getPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : specifier;
  }

  const [name] = specifier.split("/");
  return name ?? specifier;
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("file:") &&
    !specifier.startsWith("node:")
  );
}

async function findClosestPackageManifest(
  filePath: string,
): Promise<string | null> {
  let current = path.dirname(filePath);

  while (true) {
    const manifestPath = path.join(current, "package.json");
    try {
      if ((await stat(manifestPath)).isFile()) {
        return manifestPath;
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function isOptionalDependencyImport(
  specifier: string,
  importerPath: string,
): Promise<boolean> {
  if (!isBareSpecifier(specifier)) {
    return false;
  }

  const manifestPath = await findClosestPackageManifest(importerPath);
  if (!manifestPath) {
    return false;
  }

  const packageName = getPackageName(specifier);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as PackageManifest;

  if (manifest.optionalDependencies?.[packageName]) {
    return true;
  }

  return manifest.peerDependenciesMeta?.[packageName]?.optional === true;
}

async function findOptionalDynamicImports(logs: BuildLog[]): Promise<string[]> {
  const optionalImports = new Set<string>();

  for (const log of logs) {
    if (
      log.importKind !== "dynamic-import" ||
      !log.specifier ||
      !log.position?.file ||
      !log.message.includes("Could not resolve")
    ) {
      continue;
    }

    if (await isOptionalDependencyImport(log.specifier, log.position.file)) {
      optionalImports.add(log.specifier);
    }
  }

  return [...optionalImports];
}

function createMissingOptionalDependencyModule(specifier: string): string {
  return `throw new Error(${JSON.stringify(
    `Missing optional dependency "${specifier}" while evaluating pubm config. Install it in the project that requires it or avoid executing that code path during config loading.`,
  )});`;
}

function createEntryPointOutput(contents: string): BuildOutputFile {
  return {
    kind: "entry-point",
    text: async () => contents,
  };
}

function createOptionalDependencyProxyPackage(specifier: string): string {
  return [
    `const message = ${JSON.stringify(
      `Missing optional dependency "${specifier}" while evaluating pubm config. Install it in the project that requires it or avoid executing that code path during config loading.`,
    )};`,
    "const createProxy = (path = []) => new Proxy(function missingOptionalDependency() {}, {",
    "  get(_target, prop) {",
    '    if (prop === "__esModule") return true;',
    '    if (prop === "default") return createProxy(path);',
    '    if (prop === "then") return undefined;',
    "    return createProxy([...path, String(prop)]);",
    "  },",
    "  apply() {",
    '    const suffix = path.length > 0 ? " (" + path.join(".") + ")" : "";',
    "    throw new Error(message + suffix);",
    "  },",
    "  construct() {",
    '    const suffix = path.length > 0 ? " (" + path.join(".") + ")" : "";',
    "    throw new Error(message + suffix);",
    "  },",
    "});",
    "const stub = createProxy();",
    "module.exports = stub;",
    "module.exports.default = stub;",
    "module.exports.__esModule = true;",
  ].join("\n");
}

function serializeBuildLog(log: BuildLog): BuildLog {
  return {
    message: log.message,
    importKind: log.importKind,
    specifier: log.specifier,
    position: log.position?.file ? { file: log.position.file } : undefined,
  };
}

async function collectOptionalDependenciesForInputs(
  inputPaths: string[],
): Promise<string[]> {
  const manifestPaths = new Set<string>();
  for (const inputPath of inputPaths) {
    const manifestPath = await findClosestPackageManifest(inputPath);
    if (manifestPath) {
      manifestPaths.add(manifestPath);
    }
  }

  const optionalDependencies = new Set<string>();
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as PackageManifest;

    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      optionalDependencies.add(dependency);
    }

    for (const [dependency, meta] of Object.entries(
      manifest.peerDependenciesMeta ?? {},
    )) {
      if (meta.optional) {
        optionalDependencies.add(dependency);
      }
    }
  }

  return [...optionalDependencies];
}

async function findInstalledPackagePath(
  startDir: string,
  dependency: string,
): Promise<string | null> {
  let current = startDir;

  while (true) {
    const packageDir = path.join(current, "node_modules", dependency);
    try {
      if ((await stat(packageDir)).isDirectory()) {
        return packageDir;
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function writeOptionalDependencyStubs(
  moduleDir: string,
  resolveFromDir: string,
  optionalDependencies: string[],
): Promise<void> {
  const nodeModulesDir = path.join(moduleDir, "node_modules");

  for (const dependency of optionalDependencies) {
    if (await findInstalledPackagePath(resolveFromDir, dependency)) {
      continue;
    }

    const packageDir = path.join(nodeModulesDir, dependency);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify(
        {
          name: dependency,
          private: true,
          main: "./index.js",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(packageDir, "index.js"),
      createOptionalDependencyProxyPackage(dependency),
      "utf8",
    );
  }
}

function createOptionalDependencyPlugin(specifiers: string[]): Bun.BunPlugin {
  const missingSpecifiers = new Set(specifiers);

  return {
    name: "pubm-optional-dependency-plugin",
    target: "bun",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!missingSpecifiers.has(args.path)) {
          return;
        }

        return {
          path: args.path,
          namespace: OPTIONAL_DEPENDENCY_NAMESPACE,
        };
      });

      builder.onLoad(
        { filter: /.*/, namespace: OPTIONAL_DEPENDENCY_NAMESPACE },
        (args) => ({
          contents: createMissingOptionalDependencyModule(args.path),
          loader: "js",
        }),
      );
    },
  };
}

function createConfigModuleShimPlugin(): Bun.BunPlugin {
  const shims = new Map(Object.entries(CONFIG_MODULE_SHIMS));

  return {
    name: "pubm-config-module-shim-plugin",
    target: "bun",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!shims.has(args.path)) {
          return;
        }

        return {
          path: args.path,
          namespace: CONFIG_MODULE_NAMESPACE,
        };
      });

      builder.onLoad(
        { filter: /.*/, namespace: CONFIG_MODULE_NAMESPACE },
        (args) => {
          const contents = shims.get(args.path);
          if (contents === undefined) {
            throw new Error(
              `Missing config module shim for "${args.path}" in ${CONFIG_MODULE_NAMESPACE}`,
            );
          }

          return {
            contents,
            loader: "js",
          };
        },
      );
    },
  };
}

async function runBunBuild(
  build: typeof Bun.build,
  entrypoint: string,
  format: BuildFormat = "esm",
  optionalDynamicImports: string[] = [],
): Promise<ConfigBuildResult> {
  const entrypointSource = await readFile(entrypoint, "utf8");
  const result = await build({
    entrypoints: [entrypoint],
    target: "bun",
    format,
    minify: true,
    external: [],
    packages: "bundle",
    splitting: false,
    metafile: true,
    throw: false,
    files: {
      [entrypoint]: rewriteImportMeta(entrypointSource, entrypoint),
    },
    plugins: [
      createConfigModuleShimPlugin(),
      ...(optionalDynamicImports.length > 0
        ? [createOptionalDependencyPlugin(optionalDynamicImports)]
        : []),
    ],
  });

  return {
    success: result.success,
    logs: result.logs.map(serializeBuildLog),
    optionalDependencies: await collectOptionalDependenciesForInputs(
      Object.keys(result.metafile?.inputs ?? {}),
    ),
    outputs: result.outputs,
  };
}

async function buildConfig(entrypoint: string): Promise<ConfigBuildResult> {
  const build = globalThis.Bun?.build;
  if (build) {
    const initialResult = await runBunBuild(build, entrypoint);
    if (initialResult.success) {
      return initialResult;
    }

    const optionalDynamicImports = await findOptionalDynamicImports(
      initialResult.logs,
    );
    if (optionalDynamicImports.length === 0) {
      return initialResult;
    }

    return runBunBuild(build, entrypoint, "esm", optionalDynamicImports);
  }

  return buildConfigWithChildProcess(entrypoint);
}

async function buildConfigWithFormat(
  entrypoint: string,
  format: BuildFormat,
): Promise<ConfigBuildResult> {
  const build = globalThis.Bun?.build;
  if (build) {
    const initialResult = await runBunBuild(build, entrypoint, format);
    if (initialResult.success) {
      return initialResult;
    }

    const optionalDynamicImports = await findOptionalDynamicImports(
      initialResult.logs,
    );
    if (optionalDynamicImports.length === 0) {
      return initialResult;
    }

    return runBunBuild(build, entrypoint, format, optionalDynamicImports);
  }

  return buildConfigWithChildProcess(entrypoint, format);
}

async function buildConfigWithChildProcess(
  entrypoint: string,
  format: BuildFormat = "esm",
): Promise<ConfigBuildResult> {
  const extension = format === "esm" ? "mjs" : "cjs";

  const tempDir = await mkdtemp(path.join(tmpdir(), "pubm-config-"));
  const buildScript = path.join(tempDir, "build-config.mjs");
  const outfile = path.join(tempDir, `pubm.config.${extension}`);
  const resultFile = path.join(tempDir, "build-result.json");

  try {
    await writeFile(
      buildScript,
      [
        'import { readFile, stat, writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        'import { pathToFileURL } from "node:url";',
        "",
        `const OPTIONAL_DEPENDENCY_NAMESPACE = ${JSON.stringify(OPTIONAL_DEPENDENCY_NAMESPACE)};`,
        `const entrypoint = ${JSON.stringify(entrypoint)};`,
        `const format = ${JSON.stringify(format)};`,
        `const outfile = ${JSON.stringify(outfile)};`,
        `const resultFile = ${JSON.stringify(resultFile)};`,
        "",
        `const CONFIG_MODULE_NAMESPACE = ${JSON.stringify(CONFIG_MODULE_NAMESPACE)};`,
        `const CONFIG_MODULE_SHIMS = ${JSON.stringify(CONFIG_MODULE_SHIMS)};`,
        "",
        "function rewriteImportMeta(source, configPath) {",
        "  const replacements = [",
        '    ["import.meta.dirname", JSON.stringify(path.dirname(configPath))],',
        '    ["import.meta.filename", JSON.stringify(configPath)],',
        '    ["import.meta.path", JSON.stringify(configPath)],',
        '    ["import.meta.url", JSON.stringify(pathToFileURL(configPath).href)],',
        '    ["import.meta.dir", JSON.stringify(path.dirname(configPath))],',
        "  ];",
        "",
        "  let rewritten = source;",
        "  for (const [pattern, value] of replacements) {",
        "    rewritten = rewritten.split(pattern).join(value);",
        "  }",
        "",
        "  return rewritten;",
        "}",
        "",
        "function getPackageName(specifier) {",
        '  if (specifier.startsWith("@")) {',
        '    const [scope, name] = specifier.split("/");',
        '    return scope && name ? scope + "/" + name : specifier;',
        "  }",
        "",
        '  const [name] = specifier.split("/");',
        "  return name ?? specifier;",
        "}",
        "",
        "function isBareSpecifier(specifier) {",
        '  return !specifier.startsWith(".") &&',
        '    !specifier.startsWith("/") &&',
        '    !specifier.startsWith("file:") &&',
        '    !specifier.startsWith("node:");',
        "}",
        "",
        "async function findClosestPackageManifest(filePath) {",
        "  let current = path.dirname(filePath);",
        "",
        "  while (true) {",
        '    const manifestPath = path.join(current, "package.json");',
        "    try {",
        "      if ((await stat(manifestPath)).isFile()) {",
        "        return manifestPath;",
        "      }",
        "    } catch {}",
        "",
        "    const parent = path.dirname(current);",
        "    if (parent === current) {",
        "      return null;",
        "    }",
        "    current = parent;",
        "  }",
        "}",
        "",
        "async function isOptionalDependencyImport(specifier, importerPath) {",
        "  if (!isBareSpecifier(specifier)) {",
        "    return false;",
        "  }",
        "",
        "  const manifestPath = await findClosestPackageManifest(importerPath);",
        "  if (!manifestPath) {",
        "    return false;",
        "  }",
        "",
        '  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));',
        "  const packageName = getPackageName(specifier);",
        "  if (manifest.optionalDependencies?.[packageName]) {",
        "    return true;",
        "  }",
        "",
        "  return manifest.peerDependenciesMeta?.[packageName]?.optional === true;",
        "}",
        "",
        "function serializeBuildLog(log) {",
        "  return {",
        "    message: log.message,",
        "    importKind: log.importKind,",
        "    specifier: log.specifier,",
        "    position: log.position?.file ? { file: log.position.file } : undefined,",
        "  };",
        "}",
        "",
        "async function collectOptionalDependenciesForInputs(inputPaths) {",
        "  const manifestPaths = new Set();",
        "  for (const inputPath of inputPaths) {",
        "    const manifestPath = await findClosestPackageManifest(inputPath);",
        "    if (manifestPath) {",
        "      manifestPaths.add(manifestPath);",
        "    }",
        "  }",
        "",
        "  const optionalDependencies = new Set();",
        "  for (const manifestPath of manifestPaths) {",
        '    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));',
        "    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {",
        "      optionalDependencies.add(dependency);",
        "    }",
        "",
        "    for (const [dependency, meta] of Object.entries(manifest.peerDependenciesMeta ?? {})) {",
        "      if (meta.optional) {",
        "        optionalDependencies.add(dependency);",
        "      }",
        "    }",
        "  }",
        "",
        "  return [...optionalDependencies];",
        "}",
        "",
        "async function findOptionalDynamicImports(logs) {",
        "  const optionalImports = new Set();",
        "",
        "  for (const log of logs) {",
        '    if (log.importKind !== "dynamic-import" || !log.specifier || !log.position?.file || !log.message.includes("Could not resolve")) {',
        "      continue;",
        "    }",
        "",
        "    if (await isOptionalDependencyImport(log.specifier, log.position.file)) {",
        "      optionalImports.add(log.specifier);",
        "    }",
        "  }",
        "",
        "  return [...optionalImports];",
        "}",
        "",
        `const MISSING_OPTIONAL_DEPENDENCY_TEMPLATE = ${JSON.stringify(
          createMissingOptionalDependencyModule("__PUBM_OPTIONAL_DEPENDENCY__"),
        )};`,
        "",
        "function createMissingOptionalDependencyModule(specifier) {",
        '  return MISSING_OPTIONAL_DEPENDENCY_TEMPLATE.replace("__PUBM_OPTIONAL_DEPENDENCY__", specifier);',
        "}",
        "",
        "function createOptionalDependencyPlugin(specifiers) {",
        "  const missingSpecifiers = new Set(specifiers);",
        "",
        "  return {",
        '    name: "pubm-optional-dependency-plugin",',
        '    target: "bun",',
        "    setup(builder) {",
        "      builder.onResolve({ filter: /.*/ }, (args) => {",
        "        if (!missingSpecifiers.has(args.path)) {",
        "          return;",
        "        }",
        "",
        "        return { path: args.path, namespace: OPTIONAL_DEPENDENCY_NAMESPACE };",
        "      });",
        "",
        "      builder.onLoad({ filter: /.*/, namespace: OPTIONAL_DEPENDENCY_NAMESPACE }, (args) => ({",
        "        contents: createMissingOptionalDependencyModule(args.path),",
        '        loader: "js",',
        "      }));",
        "    },",
        "  };",
        "}",
        "",
        "function createConfigModuleShimPlugin() {",
        "  const shims = new Map(Object.entries(CONFIG_MODULE_SHIMS));",
        "",
        "  return {",
        '    name: "pubm-config-module-shim-plugin",',
        '    target: "bun",',
        "    setup(builder) {",
        "      builder.onResolve({ filter: /.*/ }, (args) => {",
        "        if (!shims.has(args.path)) {",
        "          return;",
        "        }",
        "",
        "        return { path: args.path, namespace: CONFIG_MODULE_NAMESPACE };",
        "      });",
        "",
        "      builder.onLoad({ filter: /.*/, namespace: CONFIG_MODULE_NAMESPACE }, (args) => ({",
        "        contents: shims.get(args.path),",
        '        loader: "js",',
        "      }));",
        "    },",
        "  };",
        "}",
        "",
        "async function runBuild(optionalDynamicImports = []) {",
        '  const entrypointSource = await readFile(entrypoint, "utf8");',
        "  return Bun.build({",
        "    entrypoints: [entrypoint],",
        '    target: "bun",',
        "    format,",
        "    minify: true,",
        "    external: [],",
        '    packages: "bundle",',
        "    splitting: false,",
        "    metafile: true,",
        "    throw: false,",
        "    files: {",
        "      [entrypoint]: rewriteImportMeta(entrypointSource, entrypoint),",
        "    },",
        "    plugins: [",
        "      createConfigModuleShimPlugin(),",
        "      ...(optionalDynamicImports.length > 0 ? [createOptionalDependencyPlugin(optionalDynamicImports)] : []),",
        "    ],",
        "  });",
        "}",
        "",
        "let result = await runBuild();",
        "if (!result.success) {",
        "  const optionalDynamicImports = await findOptionalDynamicImports(result.logs.map(serializeBuildLog));",
        "  if (optionalDynamicImports.length > 0) {",
        "    result = await runBuild(optionalDynamicImports);",
        "  }",
        "}",
        "",
        'const entrypointFile = result.outputs.find((file) => file.kind === "entry-point");',
        "if (entrypointFile) {",
        '  await writeFile(outfile, await entrypointFile.text(), "utf8");',
        "}",
        "",
        "const optionalDependencies = await collectOptionalDependenciesForInputs(",
        "  Object.keys(result.metafile?.inputs ?? {}),",
        ");",
        "",
        "await writeFile(",
        "  resultFile,",
        "  JSON.stringify({",
        "    success: result.success,",
        "    logs: result.logs.map(serializeBuildLog),",
        "    optionalDependencies,",
        "    hasEntrypoint: entrypointFile != null,",
        "  }),",
        '  "utf8",',
        ");",
      ].join("\n"),
      "utf8",
    );

    await new Promise<void>((resolve, reject) => {
      execFile("bun", [buildScript], (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr || `Failed to build config via bun: ${error.message}`,
            ),
          );
          return;
        }

        resolve();
      });
    });

    const result = JSON.parse(
      await readFile(resultFile, "utf8"),
    ) as ConfigBuildResult & { hasEntrypoint: boolean };
    const contents = result.hasEntrypoint
      ? await readFile(outfile, "utf8")
      : null;

    return {
      success: result.success,
      logs: result.logs,
      optionalDependencies: result.optionalDependencies,
      outputs: contents ? [createEntryPointOutput(contents)] : [],
    };
  } catch (error) {
    return {
      success: false,
      logs: [
        {
          message:
            error instanceof Error
              ? error.message
              : "Failed to build config via bun",
        },
      ],
      optionalDependencies: [],
      outputs: [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function rewriteImportMeta(source: string, configPath: string): string {
  const replacements = [
    ["import.meta.dirname", JSON.stringify(path.dirname(configPath))],
    ["import.meta.filename", JSON.stringify(configPath)],
    ["import.meta.path", JSON.stringify(configPath)],
    ["import.meta.url", JSON.stringify(pathToFileURL(configPath).href)],
    ["import.meta.dir", JSON.stringify(path.dirname(configPath))],
  ] as const;

  let rewritten = source;
  for (const [pattern, value] of replacements) {
    rewritten = rewritten.split(pattern).join(value);
  }

  return rewritten;
}

function normalizeConfigNamespace(
  namespace: { default?: PubmConfig } & PubmConfig,
): PubmConfig {
  return namespace.default ?? namespace;
}

async function importConfigModule(configPath: string): Promise<PubmConfig> {
  const namespace = (await import(
    `${pathToFileURL(configPath).href}?t=${Date.now()}`
  )) as { default?: PubmConfig } & PubmConfig;

  return normalizeConfigNamespace(namespace);
}

async function importBundledConfig(
  source: string,
  configPath: string,
  optionalDependencies: string[],
): Promise<PubmConfig> {
  const tempDir = await mkdtemp(
    path.join(path.dirname(configPath), ".pubm-config-module-"),
  );
  const tempFile = path.join(tempDir, "pubm.config.mjs");

  try {
    await writeOptionalDependencyStubs(
      tempDir,
      path.dirname(configPath),
      optionalDependencies,
    );
    await writeFile(tempFile, source, "utf8");
    return importConfigModule(tempFile);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function executeBundledConfigInVm(
  source: string,
  configPath: string,
): Promise<PubmConfig> {
  const module = { exports: {} as { default?: PubmConfig } & PubmConfig };
  const require = createRequire(pathToFileURL(configPath));
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    __filename: configPath,
    __dirname: path.dirname(configPath),
    console,
    process,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    Bun: globalThis.Bun,
  });

  context.globalThis = context;
  context.global = context;
  context.self = context;

  new vm.Script(source, { filename: configPath }).runInContext(context);

  return normalizeConfigNamespace(module.exports);
}

function formatStageError(stage: string, error: unknown): string {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  return `[${stage}] ${message}`;
}

export async function loadConfig(
  cwd: string = process.cwd(),
  configPath?: string,
): Promise<PubmConfig | null> {
  let resolvedConfigPath: string | null;

  if (configPath) {
    resolvedConfigPath = path.resolve(cwd, configPath);
    try {
      if (!(await stat(resolvedConfigPath)).isFile()) {
        throw new Error(`Config path is not a file: ${resolvedConfigPath}`);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Config file not found: ${resolvedConfigPath}`);
      }
      throw e;
    }
  } else {
    resolvedConfigPath = await findConfigFile(cwd);
  }

  if (!resolvedConfigPath) return null;

  const errors: string[] = [];

  try {
    return await importConfigModule(resolvedConfigPath);
  } catch (error) {
    errors.push(formatStageError("native import", error));
  }

  const output = await buildConfig(resolvedConfigPath);

  if (!output.success) {
    errors.push(
      formatStageError(
        "bundled build",
        output.logs.map((log) => log.message).join("\n"),
      ),
    );
    throw new Error(`Failed to load config:\n${errors.join("\n\n")}`);
  }

  const entrypoint = output.outputs.find((file) => file.kind === "entry-point");
  if (!entrypoint) {
    errors.push(formatStageError("bundled build", "missing entrypoint output"));
    throw new Error(`Failed to load config:\n${errors.join("\n\n")}`);
  }

  const bundledSource = await entrypoint.text();
  try {
    return await importBundledConfig(
      bundledSource,
      resolvedConfigPath,
      output.optionalDependencies,
    );
  } catch (error) {
    errors.push(formatStageError("bundled import", error));
  }

  const vmOutput = await buildConfigWithFormat(resolvedConfigPath, "cjs");
  if (!vmOutput.success) {
    errors.push(
      formatStageError(
        "bundled vm build",
        vmOutput.logs.map((log) => log.message).join("\n"),
      ),
    );
    throw new Error(`Failed to load config:\n${errors.join("\n\n")}`);
  }

  const vmEntrypoint = vmOutput.outputs.find(
    (file) => file.kind === "entry-point",
  );
  if (!vmEntrypoint) {
    errors.push(
      formatStageError("bundled vm build", "missing entrypoint output"),
    );
    throw new Error(`Failed to load config:\n${errors.join("\n\n")}`);
  }

  try {
    return await executeBundledConfigInVm(
      await vmEntrypoint.text(),
      resolvedConfigPath,
    );
  } catch (error) {
    errors.push(formatStageError("bundled vm", error));
    throw new Error(`Failed to load config:\n${errors.join("\n\n")}`);
  }
}
