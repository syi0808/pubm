import { test } from "vitest";
import { runPubmCli } from "./utils/cli";
import path from "node:path";

test('build script options', async () => {
  const { controller } = runPubmCli('0.0.2', '--contents', path.resolve(import.meta.dirname, './fixtures/build-script'), '--no-pre-check', '--no-tests', '--build-script', 'not-exist-build-scripts');

  await controller.waitForStderr("✖ Checking if test and build scripts exist");
});