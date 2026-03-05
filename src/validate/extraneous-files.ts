import micromatch from "micromatch";

export interface ExtraneousFile {
  file: string;
  reason: string;
}

interface PatternRule {
  pattern: string[];
  reason: string;
  basename?: boolean;
}

const PATTERNS: PatternRule[] = [
  {
    pattern: [".env", ".env.*"],
    reason: "potentially contains secrets",
    basename: true,
  },
  {
    pattern: ["*.test.*", "*.spec.*"],
    reason: "test file",
    basename: true,
  },
  {
    pattern: ["**/__tests__/**"],
    reason: "test file",
  },
  { pattern: ["*.map"], reason: "source map", basename: true },
  {
    pattern: [
      ".eslintrc*",
      ".prettierrc*",
      "tsconfig.json",
      "tsconfig.*.json",
      ".babelrc*",
      "jest.config.*",
      "vitest.config.*",
      ".editorconfig",
      "biome.json",
    ],
    reason: "development config file",
    basename: true,
  },
];

export function detectExtraneousFiles(files: string[]): ExtraneousFile[] {
  const result: ExtraneousFile[] = [];
  const seen = new Set<string>();

  for (const { pattern, reason, basename } of PATTERNS) {
    const options = basename ? { basename: true } : {};
    const matched = micromatch(files, pattern, options);
    for (const file of matched) {
      if (!seen.has(file)) {
        seen.add(file);
        result.push({ file, reason });
      }
    }
  }

  return result;
}
