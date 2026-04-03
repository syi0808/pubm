import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import { isCI } from "std-env";
import type { PubmContext } from "../../context.js";
import {
  collectEcosystemRegistryGroups,
  countRegistryTargets,
  ecosystemLabel,
  registryLabel,
} from "../grouping.js";
import type { NewListrParentTask } from "./publish-tasks.js";
import { getPackageName } from "./rollback-handlers.js";

export const LIVE_COMMAND_OUTPUT_LINE_LIMIT = 4;

export function formatRegistryGroupSummary(
  heading: string,
  ctx: PubmContext,
): string {
  const lines = collectEcosystemRegistryGroups(ctx.config).flatMap((group) =>
    group.registries.map(({ registry, packagePaths }) => {
      const packageSummary =
        packagePaths.length > 1 ? ` (${packagePaths.length} packages)` : "";
      return `- ${ecosystemLabel(group.ecosystem)} > ${registryLabel(registry)}${packageSummary}`;
    }),
  );

  if (lines.length === 0) {
    return heading;
  }

  return `${heading}:\n${lines.join("\n")}`;
}

export function countPublishTargets(ctx: PubmContext): number {
  return countRegistryTargets(collectEcosystemRegistryGroups(ctx.config));
}

export function formatVersionSummary(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent") {
      return [...plan.packages]
        .map(([pkgPath, ver]) => `${getPackageName(ctx, pkgPath)}@${ver}`)
        .join(", ");
    }
    return `v${plan.version}`;
  }
  return "";
}

export function formatVersionPlan(ctx: PubmContext): string {
  const plan = ctx.runtime.versionPlan;
  if (plan) {
    if (plan.mode === "independent" || plan.mode === "fixed") {
      return `Target versions:\n${[...plan.packages]
        .map(([pkgPath, ver]) => `  ${getPackageName(ctx, pkgPath)}: ${ver}`)
        .join("\n")}`;
    }
    return `Target version: v${plan.version}`;
  }
  return "";
}

export function shouldRenderLiveCommandOutput(_ctx: PubmContext): boolean {
  return !isCI && Boolean(process.stdout.isTTY);
}

export function normalizeLiveCommandOutputLine(line: string): string {
  const normalized = stripVTControlCharacters(line).trimEnd();
  return normalized.trim() ? normalized : "";
}

export function createLiveCommandOutput(
  task: Pick<NewListrParentTask<PubmContext>, "output">,
  command: string,
) {
  const recentLines: string[] = [];
  const pending = {
    stdout: "",
    stderr: "",
  };

  const render = (partialLine?: string): void => {
    const previewLines = partialLine
      ? [...recentLines, partialLine].slice(-LIVE_COMMAND_OUTPUT_LINE_LIMIT)
      : recentLines;

    task.output =
      previewLines.length > 0
        ? [`Executing \`${command}\``, ...previewLines].join("\n")
        : `Executing \`${command}\``;
  };

  const pushLine = (line: string): void => {
    const normalized = normalizeLiveCommandOutputLine(line);
    if (!normalized) {
      return;
    }

    recentLines.push(normalized);
    if (recentLines.length > LIVE_COMMAND_OUTPUT_LINE_LIMIT) {
      recentLines.shift();
    }
  };

  const updateFromChunk = (
    source: keyof typeof pending,
    chunk: string,
  ): void => {
    const segments =
      `${pending[source]}${chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}`.split(
        "\n",
      );
    pending[source] = segments.pop() as string;

    for (const segment of segments) {
      pushLine(segment);
    }

    const partialLine = normalizeLiveCommandOutputLine(pending[source]);
    render(partialLine || undefined);
  };

  const finish = (): void => {
    pushLine(pending.stdout);
    pushLine(pending.stderr);
    pending.stdout = "";
    pending.stderr = "";
    render();
  };

  render();

  return {
    onStdout: (chunk: string) => {
      updateFromChunk("stdout", chunk);
    },
    onStderr: (chunk: string) => {
      updateFromChunk("stderr", chunk);
    },
    finish,
  };
}
