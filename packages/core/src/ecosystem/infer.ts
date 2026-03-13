import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { registerPrivateRegistry } from "../registry/catalog.js";
import type { RegistryType } from "../types/options.js";
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import type { EcosystemKey } from "./catalog.js";

const NPM_OFFICIAL = "registry.npmjs.org";

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Record<string, any> | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function parseNpmrcRegistry(
  npmrcContent: string,
  packageName?: string,
): string | null {
  const lines = npmrcContent.split("\n");

  // Check scoped registry first
  if (packageName?.startsWith("@")) {
    const scope = packageName.split("/")[0];
    for (const line of lines) {
      const match = line.match(
        new RegExp(`^${scope.replace("/", "\\/")}:registry=(.+)$`),
      );
      if (match) return match[1].trim();
    }
  }

  // Check global registry
  for (const line of lines) {
    const match = line.match(/^registry=(.+)$/);
    if (match) return match[1].trim();
  }

  return null;
}

function isOfficialNpmRegistry(url: string): boolean {
  return normalizeRegistryUrl(url).includes(NPM_OFFICIAL);
}

function registryUrlToKey(url: string, ecosystemKey: EcosystemKey): string {
  const key = normalizeRegistryUrl(url);
  registerPrivateRegistry(
    {
      url,
      token: {
        envVar: `${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOKEN`,
      },
    },
    ecosystemKey,
  );
  return key;
}

async function inferJsRegistries(
  packagePath: string,
  rootPath?: string,
): Promise<RegistryType[]> {
  const registries: RegistryType[] = [];

  const hasPackageJson = await fileExists(join(packagePath, "package.json"));
  const hasJsrJson = await fileExists(join(packagePath, "jsr.json"));

  if (!hasPackageJson && hasJsrJson) {
    return ["jsr"];
  }

  if (!hasPackageJson) {
    return [];
  }

  const packageJson = await readJsonSafe(join(packagePath, "package.json"));
  const packageName = packageJson?.name as string | undefined;
  const publishConfigRegistry = packageJson?.publishConfig?.registry as
    | string
    | undefined;

  let npmRegistryUrl: string | null = null;

  if (publishConfigRegistry) {
    npmRegistryUrl = publishConfigRegistry;
  } else {
    const npmrcContent = await readFileSafe(join(packagePath, ".npmrc"));
    if (npmrcContent) {
      npmRegistryUrl = parseNpmrcRegistry(npmrcContent, packageName);
    }
    if (!npmRegistryUrl && rootPath && rootPath !== packagePath) {
      const rootNpmrc = await readFileSafe(join(rootPath, ".npmrc"));
      if (rootNpmrc) {
        npmRegistryUrl = parseNpmrcRegistry(rootNpmrc, packageName);
      }
    }
  }

  if (npmRegistryUrl && !isOfficialNpmRegistry(npmRegistryUrl)) {
    registries.push(registryUrlToKey(npmRegistryUrl, "js"));
  } else {
    registries.push("npm");
  }

  if (hasJsrJson) {
    registries.push("jsr");
  }

  return registries;
}

async function inferRustRegistries(
  _packagePath: string,
): Promise<RegistryType[]> {
  return ["crates"];
}

export async function inferRegistries(
  packagePath: string,
  ecosystemKey: EcosystemKey,
  rootPath?: string,
): Promise<RegistryType[]> {
  switch (ecosystemKey) {
    case "js":
      return inferJsRegistries(packagePath, rootPath);
    case "rust":
      return inferRustRegistries(packagePath);
    default:
      return [];
  }
}
