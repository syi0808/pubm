import {
  Listr,
  type ListrBaseClassOptions,
  type ListrRendererFactory,
  type ListrRendererValue,
  type ListrTask,
  type ListrTaskObject,
} from "listr2";
import {
  PubmCiRenderer,
  type PubmCiRendererOptions,
} from "./listr-ci-renderer.js";
import { rollback } from "./rollback.js";

type PubmListrTask<Context extends {}> =
  | ListrTask<Context, ListrRendererFactory, ListrRendererFactory>
  | ListrTask<Context, ListrRendererFactory, ListrRendererFactory>[];

type PubmListrOptions<Context extends {}> = ListrBaseClassOptions<
  Context,
  ListrRendererValue,
  ListrRendererValue
>;

type PubmParentTask<Context extends {}> = ListrTaskObject<
  Context,
  ListrRendererFactory,
  ListrRendererFactory
>;

type PubmCiListrOptions<Context extends {}> = ListrBaseClassOptions<
  Context,
  typeof PubmCiRenderer,
  typeof PubmCiRenderer
>;

export function createCiListrOptions<Context extends {}>(
  options: Partial<PubmCiListrOptions<Context>> = {},
): PubmCiListrOptions<Context> {
  return {
    ...options,
    renderer: PubmCiRenderer,
    fallbackRenderer: PubmCiRenderer,
    rendererOptions: {
      logTitleChange: true,
      ...(options.rendererOptions as PubmCiRendererOptions | undefined),
    },
    fallbackRendererOptions: {
      logTitleChange: true,
      ...(options.fallbackRendererOptions as PubmCiRendererOptions | undefined),
    },
  };
}

export function createListr<Context extends {}>(
  task: PubmListrTask<Context>,
  options?: PubmListrOptions<Context>,
  parentTask?: PubmParentTask<Context>,
): Listr<Context> {
  const listr = new Listr<Context, ListrRendererValue, ListrRendererValue>(
    task as never,
    options as never,
    parentTask as never,
  ) as unknown as Listr<Context>;

  listr.isRoot = () => false;

  // externalSignalHandler is injected through the patched listr2 build.
  // we should make pr on listr2 for new option externalSignalHandler
  // @ts-expect-error
  listr.externalSignalHandler = rollback;

  return listr;
}
