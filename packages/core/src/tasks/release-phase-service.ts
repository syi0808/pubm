import {
  createCiRunnerOptions,
  createTaskRunner,
  type Task,
} from "@pubm/runner";
import { isCI } from "std-env";
import type { PubmContext } from "../context.js";
import { createDryRunTasks } from "./phases/dry-run.js";
import { createPublishTasks } from "./phases/publish.js";
import { createPushTask, createReleaseTask } from "./phases/push-release.js";
import { createBuildTask, createTestTask } from "./phases/test-build.js";
import { createVersionTask } from "./phases/version.js";

interface TestPhaseInput {
  hasPrepare: boolean;
  skipTests: boolean;
}

interface BuildPhaseInput {
  hasPrepare: boolean;
  skipBuild: boolean;
}

interface VersionPhaseInput {
  hasPrepare: boolean;
  dryRun: boolean;
}

interface PublishPhaseInput {
  hasPublish: boolean;
  dryRun: boolean;
  skipPublish: boolean;
}

interface DryRunPhaseInput {
  dryRun: boolean;
  mode: string;
  hasPrepare: boolean;
  skipDryRun: boolean;
}

interface PushPhaseInput {
  hasPrepare: boolean;
  dryRun: boolean;
}

interface ReleasePhaseInput {
  hasPublish: boolean;
  dryRun: boolean;
  mode: string;
  skipReleaseDraft: boolean;
}

export interface ReleasePhaseService {
  runTest(ctx: PubmContext, input: TestPhaseInput): Promise<void>;
  runBuild(ctx: PubmContext, input: BuildPhaseInput): Promise<void>;
  runVersion(ctx: PubmContext, input: VersionPhaseInput): Promise<void>;
  runPublish(ctx: PubmContext, input: PublishPhaseInput): Promise<void>;
  runDryRun(ctx: PubmContext, input: DryRunPhaseInput): Promise<void>;
  runPush(ctx: PubmContext, input: PushPhaseInput): Promise<void>;
  runRelease(ctx: PubmContext, input: ReleasePhaseInput): Promise<void>;
}

class NativeReleasePhaseService implements ReleasePhaseService {
  async runTest(ctx: PubmContext, input: TestPhaseInput): Promise<void> {
    await runTasks(ctx, [createTestTask(input.hasPrepare, input.skipTests)]);
  }

  async runBuild(ctx: PubmContext, input: BuildPhaseInput): Promise<void> {
    await runTasks(ctx, [createBuildTask(input.hasPrepare, input.skipBuild)]);
  }

  async runVersion(ctx: PubmContext, input: VersionPhaseInput): Promise<void> {
    await runTasks(ctx, [createVersionTask(input.hasPrepare, input.dryRun)]);
  }

  async runPublish(ctx: PubmContext, input: PublishPhaseInput): Promise<void> {
    await runTasks(
      ctx,
      createPublishTasks(input.hasPublish, input.dryRun, input.skipPublish),
    );
  }

  async runDryRun(ctx: PubmContext, input: DryRunPhaseInput): Promise<void> {
    await runTasks(
      ctx,
      createDryRunTasks(
        input.dryRun,
        input.mode,
        input.hasPrepare,
        input.skipDryRun,
      ),
    );
  }

  async runPush(ctx: PubmContext, input: PushPhaseInput): Promise<void> {
    await runTasks(ctx, [createPushTask(input.hasPrepare, input.dryRun)]);
  }

  async runRelease(ctx: PubmContext, input: ReleasePhaseInput): Promise<void> {
    await runTasks(ctx, [
      createReleaseTask(
        input.hasPublish,
        input.dryRun,
        input.mode,
        input.skipReleaseDraft,
      ),
    ]);
  }
}

async function runTasks(
  ctx: PubmContext,
  tasks: readonly Task<PubmContext>[],
): Promise<void> {
  const options = isCI ? createCiRunnerOptions<PubmContext>() : undefined;
  await createTaskRunner<PubmContext>([...tasks], options).run(ctx);
}

export const nativeReleasePhaseService: ReleasePhaseService =
  new NativeReleasePhaseService();
