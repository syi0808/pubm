import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { version } from "@pubm/core";
import type { Command } from "commander";

export interface DiscoveredReference {
  file: string;
  type: "json" | "pattern";
  jsonPath?: string;
  match?: string;
  line?: number;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".pubm",
  ".worktrees",
  "target",
]);

const SKIP_FILES = new Set([
  "package.json",
  "jsr.json",
  "Cargo.toml",
  "Cargo.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "CHANGELOG.md",
]);

const MAX_FILE_SIZE = 1_000_000; // 1MB

const VERSION_PATTERNS = [/@version/, /v\d/, /"version"/, /'version'/];

function isDotfile(name: string): boolean {
  return name.startsWith(".") && name !== ".claude-plugin";
}

function scanJsonValue(
  obj: unknown,
  currentVersion: string,
  currentPath: string,
): { jsonPath: string }[] {
  const results: { jsonPath: string }[] = [];

  if (obj === null || obj === undefined) return results;

  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      if (key === "version" && value === currentVersion) {
        results.push({ jsonPath: newPath });
      }
      results.push(...scanJsonValue(value, currentVersion, newPath));
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      results.push(
        ...scanJsonValue(obj[i], currentVersion, `${currentPath}[${i}]`),
      );
    }
  }

  return results;
}

export async function discoverVersionReferences(
  cwd: string,
  currentVersion: string,
): Promise<DiscoveredReference[]> {
  const results: DiscoveredReference[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { encoding: "utf8", withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name) || isDotfile(name)) continue;
        await walk(path.join(dir, name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (SKIP_FILES.has(name) || isDotfile(name)) continue;

      const fullPath = path.join(dir, name);
      const relativePath = path.relative(cwd, fullPath);

      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > MAX_FILE_SIZE) continue;
      } catch {
        continue;
      }

      let content: string;
      try {
        content = await readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (name.endsWith(".json")) {
        try {
          const parsed = JSON.parse(content);
          const matches = scanJsonValue(parsed, currentVersion, "");
          for (const match of matches) {
            results.push({
              file: relativePath,
              type: "json",
              jsonPath: match.jsonPath,
            });
          }
        } catch {
          // Not valid JSON, skip
        }
        continue;
      }

      // Text file scanning
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes(currentVersion)) continue;

        const hasPattern = VERSION_PATTERNS.some((pattern) =>
          pattern.test(line),
        );
        if (hasPattern) {
          results.push({
            file: relativePath,
            type: "pattern",
            match: line.trim(),
            line: i + 1,
          });
        }
      }
    }
  }

  await walk(cwd);
  return results;
}

export function registerSyncCommand(parent: Command): void {
  parent
    .command("sync")
    .description("Manage version synchronization across files")
    .option("--discover", "Discover version references in the project")
    .action(async (options: { discover?: boolean }) => {
      if (!options.discover) {
        console.log(
          "Usage: pubm sync --discover\n\nFlags:\n  --discover  Scan project files for version references",
        );
        return;
      }

      const cwd = process.cwd();
      const currentVersion = await version({ cwd });

      console.log(`Scanning for version references (v${currentVersion})...\n`);

      const refs = await discoverVersionReferences(cwd, currentVersion);

      if (refs.length === 0) {
        console.log("No version references found outside of manifest files.");
        return;
      }

      console.log(`Found ${refs.length} version reference(s):\n`);

      for (const ref of refs) {
        if (ref.type === "json") {
          console.log(`  ${ref.file}  (JSON: ${ref.jsonPath})`);
        } else {
          console.log(`  ${ref.file}:${ref.line}  ${ref.match}`);
        }
      }

      console.log("\nAdd these to your pubm config to keep them in sync:");
      console.log("```json");
      console.log(
        JSON.stringify(
          {
            versionSync: refs.map((ref) =>
              ref.type === "json"
                ? { file: ref.file, type: "json", path: ref.jsonPath }
                : { file: ref.file, type: "pattern" },
            ),
          },
          null,
          2,
        ),
      );
      console.log("```");
    });
}
