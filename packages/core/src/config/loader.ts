import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

async function buildConfig(entrypoint: string) {
  const build = globalThis.Bun?.build;
  if (build) {
    return build({
      entrypoints: [entrypoint],
      target: "bun",
      format: "esm",
      minify: true,
      external: [],
      packages: "bundle",
      splitting: false,
    });
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "pubm-config-"));
  const outfile = path.join(tempDir, "pubm.config.mjs");

  try {
    const { stderr } = await new Promise<{ stderr: string }>(
      (resolve, reject) => {
        execFile(
          "bun",
          [
            "build",
            entrypoint,
            "--target",
            "bun",
            "--format",
            "esm",
            "--minify",
            "--packages",
            "bundle",
            "--outfile",
            outfile,
          ],
          (error, _stdout, stderr) => {
            if (error) {
              reject(
                new Error(
                  stderr || `Failed to build config via bun: ${error.message}`,
                ),
              );
              return;
            }

            resolve({ stderr });
          },
        );
      },
    );
    const contents = await readFile(outfile, "utf8");

    return {
      success: true,
      logs: stderr ? [{ message: stderr }] : [],
      outputs: [
        {
          kind: "entry-point" as const,
          text: async () => contents,
        },
      ],
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

async function importBundledConfig(
  source: string,
  configPath: string,
): Promise<PubmConfig> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "pubm-config-module-"));
  const tempFile = path.join(tempDir, "pubm.config.mjs");

  try {
    await writeFile(tempFile, rewriteImportMeta(source, configPath), "utf8");
    const namespace = (await import(
      `${pathToFileURL(tempFile).href}?t=${Date.now()}`
    )) as { default?: PubmConfig } & PubmConfig;

    return namespace.default ?? namespace;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<PubmConfig | null> {
  const configPath = await findConfigFile(cwd);
  if (!configPath) return null;

  const output = await buildConfig(configPath);

  if (!output.success) {
    const errors = output.logs.map((log) => log.message).join("\n");
    throw new Error(`Failed to build config: ${errors}`);
  }

  const entrypoint = output.outputs.find((file) => file.kind === "entry-point");
  if (!entrypoint) {
    throw new Error(`Failed to build config: missing entrypoint output`);
  }

  return importBundledConfig(await entrypoint.text(), configPath);
}
