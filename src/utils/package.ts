import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { PackageConfig } from "../config/types.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import type { JsrJson } from "../types/jsr-json.js";
import type {
  PackageExportsEntryObject,
  PackageJson,
} from "../types/package-json.js";

const cachedPackageJson: Record<string, PackageJson> = {};
const cachedJsrJson: Record<string, JsrJson> = {};

// If the `name` field in the JSR JSON is not the scoped name from `package.json`,
// update the cached JSR JSON accordingly.
export function patchCachedJsrJson(
  contents: Partial<JsrJson>,
  { cwd = process.cwd() } = {},
): void {
  cachedJsrJson[cwd] = { ...cachedJsrJson[cwd], ...contents };
}

export async function findOutFile(
  file: string,
  { cwd = process.cwd() } = {},
): Promise<string | null> {
  let directory = cwd;
  let filePath = "";
  const { root } = path.parse(cwd);

  while (directory) {
    filePath = path.join(directory, file);

    try {
      if ((await stat(filePath)).isFile()) {
        break;
      }
    } catch {}

    directory = path.dirname(directory);

    if (directory === root) return null;
  }

  return filePath;
}

export async function getPackageJson({
  cwd = process.cwd(),
  fallbackJsr = true,
} = {}): Promise<PackageJson> {
  if (cachedPackageJson[cwd]) return cachedPackageJson[cwd];

  try {
    const packageJsonPath = await findOutFile("package.json");

    const raw = packageJsonPath && (await readFile(packageJsonPath)).toString();

    if (!raw) {
      if (!fallbackJsr) {
        throw new Error(
          "Can't find either package.json or jsr.json. Please create one of them.",
        );
      }

      const packageJson = await jsrJsonToPackageJson(
        await getJsrJson({ fallbackPackage: false }),
      );

      cachedPackageJson[cwd] = packageJson;

      return packageJson;
    }

    const packageJson = JSON.parse(raw);
    cachedPackageJson[cwd] = packageJson;

    return packageJson;
  } catch (error) {
    throw new AbstractError(
      "The root package.json is not in valid JSON format. Please check the file for errors.",
      { cause: error },
    );
  }
}

export async function getJsrJson({
  cwd = process.cwd(),
  fallbackPackage = true,
} = {}): Promise<JsrJson> {
  if (cachedJsrJson[cwd]) return cachedJsrJson[cwd];

  try {
    const jsrJsonPath = await findOutFile("jsr.json");
    const raw = jsrJsonPath && (await readFile(jsrJsonPath)).toString();

    if (!raw) {
      if (!fallbackPackage) {
        throw new Error(
          "Can't find either package.json or jsr.json. Please create one of them.",
        );
      }

      const jsrJson = await packageJsonToJsrJson(
        await getPackageJson({ fallbackJsr: false }),
      );

      cachedJsrJson[cwd] = jsrJson;

      return jsrJson;
    }

    const jsrJson = JSON.parse(raw);
    cachedJsrJson[cwd] = jsrJson;

    return jsrJson;
  } catch (error) {
    throw new AbstractError(
      "The root jsr.json is not in valid JSON format. Please check the file for errors.",
      { cause: error },
    );
  }
}

export async function packageJsonToJsrJson(
  packageJson: PackageJson,
): Promise<JsrJson> {
  const ignore =
    (await findOutFile(".npmignore")) || (await findOutFile(".gitignore"));

  const ignores = ignore?.split("\n").filter((v) => v) ?? [];

  return <JsrJson>{
    name: packageJson.name,
    version: packageJson.version,
    exports:
      packageJson.exports &&
      convertExports(packageJson.exports as string | PackageExportsEntryObject),
    publish: {
      exclude: [
        ...(packageJson.files?.flatMap((file) =>
          file.startsWith("!") ? [file.slice(1)] : [],
        ) ?? []),
        ...ignores,
      ],
      include: packageJson.files?.filter((file) => !file.startsWith("!")) ?? [],
    },
  };

  function convertExports(
    exports: string | PackageExportsEntryObject,
  ): string | Record<string, string | PackageExportsEntryObject> {
    if (typeof exports === "string") return exports;

    const convertedExports: Record<string, string | PackageExportsEntryObject> =
      {};

    for (const [exportKey, exportValue] of Object.entries(exports)) {
      convertedExports[exportKey] =
        typeof exportValue === "string"
          ? exportValue
          : convertExports(
              (exportValue as PackageExportsEntryObject).import as
                | string
                | PackageExportsEntryObject,
            );
    }

    return convertedExports;
  }
}

export function jsrJsonToPackageJson(jsrJson: JsrJson): PackageJson {
  return <PackageJson>{
    name: jsrJson.name,
    version: jsrJson.version,
    files: [
      ...(jsrJson.publish?.include ?? []),
      ...(jsrJson.publish?.exclude?.map((v) => `!${v}`) ?? []),
    ],
    exports: jsrJson.exports && convertExports(jsrJson.exports),
  };

  function convertExports(
    exports: string | Record<string, string>,
  ): string | Record<string, PackageExportsEntryObject> {
    if (typeof exports === "string") return exports;

    const convertedExports: Record<string, PackageExportsEntryObject> = {};

    for (const [exportKey, exportValue] of Object.entries(exports)) {
      convertedExports[exportKey] = {
        import: exportValue,
      };
    }

    return convertedExports;
  }
}

export async function version({ cwd = process.cwd() } = {}): Promise<string> {
  let version = (await getPackageJson({ cwd }))?.version;

  if (!version) {
    version = (await getJsrJson({ cwd }))?.version;

    if (!version)
      throw new Error(
        "Can't find either package.json or jsr.json. Please create one of them.",
      );
  }

  return version;
}

const versionRegex = /("version"\s*:\s*")[^"]*(")/;

export async function replaceVersion(
  version: string,
  packages?: PackageConfig[],
): Promise<string[]> {
  const results = await Promise.all([
    (async () => {
      const packageJsonPath = await findOutFile("package.json");

      if (!packageJsonPath) return void 0;

      const packageJson = (await readFile(packageJsonPath)).toString();

      try {
        await writeFile(
          packageJsonPath,
          packageJson.replace(versionRegex, `$1${version}$2`),
        );
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to package.json: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }

      return "package.json";
    })(),
    (async () => {
      const jsrJsonPath = await findOutFile("jsr.json");

      if (!jsrJsonPath) return void 0;

      const jsrJson = (await readFile(jsrJsonPath)).toString();

      try {
        await writeFile(
          jsrJsonPath,
          jsrJson.replace(versionRegex, `$1${version}$2`),
        );
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to jsr.json: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }

      return "jsr.json";
    })(),
  ]);

  // Handle Rust crates separately — sibling deps must be updated sequentially
  const cratePackages = (packages ?? []).filter((pkg) =>
    pkg.registries.includes("crates"),
  );

  const crateFiles: string[] = [];

  if (cratePackages.length > 0) {
    const ecosystems: { eco: RustEcosystem; pkg: PackageConfig }[] = [];

    // Phase 1: Write versions to all crate Cargo.tomls
    for (const pkg of cratePackages) {
      const eco = new RustEcosystem(path.resolve(pkg.path));
      try {
        await eco.writeVersion(version);
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to Cargo.toml at ${pkg.path}: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
      ecosystems.push({ eco, pkg });
    }

    // Phase 2: Update sibling dependency versions
    if (ecosystems.length > 1) {
      const siblingVersions = new Map<string, string>();
      for (const { eco } of ecosystems) {
        siblingVersions.set(await eco.packageName(), version);
      }

      await Promise.all(
        ecosystems.map(({ eco }) =>
          eco.updateSiblingDependencyVersions(siblingVersions),
        ),
      );
    }

    // Phase 3: Sync lockfiles
    for (const { eco, pkg } of ecosystems) {
      crateFiles.push(path.join(pkg.path, "Cargo.toml"));
      try {
        const lockfilePath = await eco.syncLockfile();
        if (lockfilePath) crateFiles.push(lockfilePath);
      } catch (error) {
        throw new AbstractError(
          `Failed to sync Cargo.lock at ${pkg.path}: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
    }
  }

  const allFiles: string[] = [];
  for (const r of results) {
    if (r) allFiles.push(r);
  }
  allFiles.push(...crateFiles);

  return [...new Set(allFiles)];
}
