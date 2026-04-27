import type {
  DetectResult,
  MigrationSource,
  MigrationSourceName,
} from "./types.js";

export interface DetectedSource {
  adapter: MigrationSource;
  result: DetectResult;
}

function isDetectedSource(
  result: DetectedSource | undefined,
): result is DetectedSource {
  return result?.result.found === true;
}

export async function detectMigrationSources(
  cwd: string,
  adapters: MigrationSource[],
  from?: MigrationSourceName,
): Promise<DetectedSource[]> {
  const filtered = from ? adapters.filter((a) => a.name === from) : adapters;

  const results = await Promise.all(
    filtered.map(async (adapter) => {
      try {
        return { adapter, result: await adapter.detect(cwd) };
      } catch {
        return undefined;
      }
    }),
  );

  return results.filter(isDetectedSource);
}
