import { describe, expect, it } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import { registerRemoteTagRollback } from "../../../src/tasks/runner-utils/rollback-handlers.js";

function createMockContext(
	plan: PubmContext["runtime"]["versionPlan"],
	registryQualifiedTags = false,
): PubmContext {
	const rollbackItems: Array<{ label: string }> = [];
	return {
		config: {
			registryQualifiedTags,
			excludeRelease: [],
			packages: [
				{
					name: "my-pkg",
					path: "packages/my-pkg",
					ecosystem: "js",
					registries: ["npm"],
					version: "1.0.0",
					dependencies: [],
				},
			],
		},
		runtime: {
			versionPlan: plan,
			rollback: {
				add: (item: { label: string }) => rollbackItems.push(item),
				items: rollbackItems,
			},
		},
	} as unknown as PubmContext;
}

describe("registerRemoteTagRollback", () => {
	it("uses standard tag format when registryQualifiedTags is false", () => {
		const ctx = createMockContext({
			mode: "independent",
			packages: new Map([["packages/my-pkg::js", "1.0.0"]]),
		});
		registerRemoteTagRollback(ctx);
		const items = (
			ctx.runtime.rollback as unknown as {
				items: Array<{ label: string }>;
			}
		).items;
		expect(items).toHaveLength(1);
		expect(items[0].label).toContain("my-pkg@1.0.0");
	});

	it("uses registry-qualified tag format when registryQualifiedTags is true", () => {
		const ctx = createMockContext(
			{
				mode: "independent",
				packages: new Map([["packages/my-pkg::js", "1.0.0"]]),
			},
			true,
		);
		registerRemoteTagRollback(ctx);
		const items = (
			ctx.runtime.rollback as unknown as {
				items: Array<{ label: string }>;
			}
		).items;
		expect(items).toHaveLength(1);
		expect(items[0].label).toContain("npm/my-pkg@1.0.0");
	});
});
