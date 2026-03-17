import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

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
      await cp(fixtureDir, tmpDir, { recursive: true });
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
