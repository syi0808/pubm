import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

function copyDirSync(src: string, dest: string): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export class FixtureManager {
  private constructor(private tmpDir: string) {}

  static async create(fixtureName?: string): Promise<FixtureManager> {
    const prefix = fixtureName ?? "empty";
    const tmpDir = await mkdtemp(path.join(tmpdir(), `pubm-e2e-${prefix}-`));

    if (fixtureName) {
      const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
      if (!existsSync(fixtureDir)) {
        await rm(tmpDir, { recursive: true, force: true });
        throw new Error(
          `Fixture not found: ${fixtureName} (looked in ${fixtureDir})`,
        );
      }
      copyDirSync(fixtureDir, tmpDir);
    }

    return new FixtureManager(tmpDir);
  }

  get dir(): string {
    return this.tmpDir;
  }

  async cleanup(): Promise<void> {
    await rm(this.tmpDir, { recursive: true, force: true });
  }
}
