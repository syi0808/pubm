import path from "node:path";
import { discoverPackages } from "../monorepo/discover.js";
import { getPackageJson } from "../utils/package.js";

export interface PackageVersionInfo {
  name: string;
  version: string;
  path: string;
}

export async function discoverCurrentVersions(
  cwd: string,
): Promise<Map<string, string>> {
  const discovered = await discoverPackages({ cwd });
  const versions = new Map<string, string>();

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const json = await getPackageJson({ cwd: pkgCwd });
        versions.set(json.name ?? pkg.path, json.version ?? "0.0.0");
      } catch {
        versions.set(pkg.path, "0.0.0");
      }
    }
  } else {
    const json = await getPackageJson({ cwd });
    versions.set(json.name ?? "unknown", json.version ?? "0.0.0");
  }

  return versions;
}

export async function discoverPackageInfos(
  cwd: string,
): Promise<PackageVersionInfo[]> {
  const discovered = await discoverPackages({ cwd });
  const infos: PackageVersionInfo[] = [];

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const json = await getPackageJson({ cwd: pkgCwd });
        infos.push({
          name: json.name ?? pkg.path,
          version: json.version ?? "0.0.0",
          path: pkg.path,
        });
      } catch {
        infos.push({ name: pkg.path, version: "0.0.0", path: pkg.path });
      }
    }
  } else {
    const json = await getPackageJson({ cwd });
    infos.push({
      name: json.name ?? "unknown",
      version: json.version ?? "0.0.0",
      path: ".",
    });
  }

  return infos;
}
