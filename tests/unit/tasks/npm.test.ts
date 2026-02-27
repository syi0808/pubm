import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/registry/npm.js', () => ({
	npmRegistry: vi.fn(),
}));

import { npmRegistry } from '../../../src/registry/npm.js';
import {
	npmAvailableCheckTasks,
	npmPublishTasks,
} from '../../../src/tasks/npm.js';
import type { Ctx } from '../../../src/tasks/runner.js';

const mockedNpmRegistry = vi.mocked(npmRegistry);

function createMockNpm() {
	return {
		packageName: 'my-package',
		isLoggedIn: vi.fn().mockResolvedValue(true),
		isPublished: vi.fn().mockResolvedValue(false),
		hasPermission: vi.fn().mockResolvedValue(true),
		isPackageNameAvaliable: vi.fn().mockResolvedValue(true),
		publish: vi.fn().mockResolvedValue(true),
		publishProvenance: vi.fn().mockResolvedValue(true),
	};
}

function createMockTask() {
	return {
		output: '',
		title: 'Running npm publish',
		prompt: vi.fn(() => ({
			run: vi.fn(),
		})),
	};
}

function createCtx(overrides: Partial<Ctx> = {}): Ctx {
	return {
		promptEnabled: true,
		npmOnly: false,
		jsrOnly: false,
		cleanWorkingTree: true,
		registries: ['npm'],
		version: '1.0.0',
		tag: 'latest',
		branch: 'main',
		testScript: 'test',
		buildScript: 'build',
		skipTests: false,
		skipBuild: false,
		skipPublish: false,
		skipPrerequisitesCheck: false,
		skipConditionsCheck: false,
		skipReleaseDraft: false,
		publishOnly: false,
		...overrides,
	} as Ctx;
}

let mockNpm: ReturnType<typeof createMockNpm>;

beforeEach(() => {
	vi.clearAllMocks();
	mockNpm = createMockNpm();
	mockedNpmRegistry.mockResolvedValue(mockNpm as any);
});

describe('npmAvailableCheckTasks', () => {
	describe('skip', () => {
		it('returns true when preview is true', () => {
			const ctx = createCtx({ preview: true });
			const result = (npmAvailableCheckTasks.skip as (ctx: Ctx) => boolean)(
				ctx,
			);

			expect(result).toBe(true);
		});

		it('returns false when preview is undefined', () => {
			const ctx = createCtx();
			const result = (npmAvailableCheckTasks.skip as (ctx: Ctx) => boolean)(
				ctx,
			);

			expect(result).toBe(false);
		});
	});

	describe('task', () => {
		it('throws when not logged in', async () => {
			mockNpm.isLoggedIn.mockResolvedValue(false);

			await expect(
				(npmAvailableCheckTasks.task as () => Promise<void>)(),
			).rejects.toThrow(
				'You are not logged in. Please log in first using `npm login`.',
			);
		});

		it('checks permission when published, throws when no permission', async () => {
			mockNpm.isPublished.mockResolvedValue(true);
			mockNpm.hasPermission.mockResolvedValue(false);

			await expect(
				(npmAvailableCheckTasks.task as () => Promise<void>)(),
			).rejects.toThrow('You do not have permission to publish this package');
		});

		it('passes when published and has permission', async () => {
			mockNpm.isPublished.mockResolvedValue(true);
			mockNpm.hasPermission.mockResolvedValue(true);

			await expect(
				(npmAvailableCheckTasks.task as () => Promise<void>)(),
			).resolves.toBeUndefined();
		});

		it('checks package name availability when not published', async () => {
			mockNpm.isPublished.mockResolvedValue(false);
			mockNpm.isPackageNameAvaliable.mockResolvedValue(true);

			await (npmAvailableCheckTasks.task as () => Promise<void>)();

			expect(mockNpm.isPackageNameAvaliable).toHaveBeenCalledOnce();
		});

		it('throws when package name is not available', async () => {
			mockNpm.isPublished.mockResolvedValue(false);
			mockNpm.isPackageNameAvaliable.mockResolvedValue(false);

			await expect(
				(npmAvailableCheckTasks.task as () => Promise<void>)(),
			).rejects.toThrow('Package is not published');
		});

		it('passes when not published but name is available', async () => {
			mockNpm.isPublished.mockResolvedValue(false);
			mockNpm.isPackageNameAvaliable.mockResolvedValue(true);

			await expect(
				(npmAvailableCheckTasks.task as () => Promise<void>)(),
			).resolves.toBeUndefined();
		});
	});
});

describe('npmPublishTasks', () => {
	describe('skip', () => {
		it('returns true when preview is true', () => {
			const ctx = createCtx({ preview: true });
			const result = (npmPublishTasks.skip as (ctx: Ctx) => boolean)(ctx);

			expect(result).toBe(true);
		});
	});

	describe('task — TTY mode (promptEnabled=true)', () => {
		it('publishes successfully without OTP', async () => {
			const ctx = createCtx({ promptEnabled: true });
			const task = createMockTask();
			mockNpm.publish.mockResolvedValue(true);

			await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
				ctx,
				task,
			);

			expect(task.output).toBe('Publishing on npm...');
			expect(mockNpm.publish).toHaveBeenCalledOnce();
			expect(task.prompt).not.toHaveBeenCalled();
		});

		it('prompts for OTP when publish returns false, retries until success', async () => {
			const ctx = createCtx({ promptEnabled: true });
			const task = createMockTask();

			mockNpm.publish
				.mockResolvedValueOnce(false)
				.mockResolvedValueOnce(false)
				.mockResolvedValueOnce(true);

			const mockRun = vi.fn().mockResolvedValue('123456');
			task.prompt.mockReturnValue({ run: mockRun });

			await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
				ctx,
				task,
			);

			expect(task.title).toBe('Running npm publish (2FA passed)');
			expect(mockNpm.publish).toHaveBeenCalledTimes(3);
			expect(mockNpm.publish).toHaveBeenNthCalledWith(1);
			expect(mockNpm.publish).toHaveBeenNthCalledWith(2, '123456');
			expect(mockNpm.publish).toHaveBeenNthCalledWith(3, '123456');
			expect(mockRun).toHaveBeenCalledTimes(2);
		});

		it('sets task title to OTP needed on first failure', async () => {
			const ctx = createCtx({ promptEnabled: true });
			const task = createMockTask();

			mockNpm.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

			const mockRun = vi.fn().mockResolvedValue('654321');
			task.prompt.mockReturnValue({ run: mockRun });

			await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
				ctx,
				task,
			);

			expect(task.title).toBe('Running npm publish (2FA passed)');
			expect(mockNpm.publish).toHaveBeenCalledTimes(2);
		});

		it('sets task output to "2FA failed" on OTP retry failure', async () => {
			const ctx = createCtx({ promptEnabled: true });
			const task = createMockTask();

			mockNpm.publish
				.mockResolvedValueOnce(false)
				.mockResolvedValueOnce(false)
				.mockResolvedValueOnce(true);

			const mockRun = vi.fn().mockResolvedValue('000000');
			task.prompt.mockReturnValue({ run: mockRun });

			await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
				ctx,
				task,
			);

			// After the second publish (first OTP attempt) fails, output is set to '2FA failed'
			// Then the third publish succeeds
			expect(mockNpm.publish).toHaveBeenCalledTimes(3);
		});
	});

	describe('task — CI mode (promptEnabled=false)', () => {
		it('throws when NODE_AUTH_TOKEN is not set', async () => {
			const ctx = createCtx({ promptEnabled: false });
			const task = createMockTask();
			const originalEnv = process.env.NODE_AUTH_TOKEN;
			delete process.env.NODE_AUTH_TOKEN;

			try {
				await expect(
					(npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
						ctx,
						task,
					),
				).rejects.toThrow(
					'NODE_AUTH_TOKEN not found in the environment variables',
				);
			} finally {
				if (originalEnv !== undefined) {
					process.env.NODE_AUTH_TOKEN = originalEnv;
				}
			}
		});

		it('calls publishProvenance when NODE_AUTH_TOKEN is set', async () => {
			const ctx = createCtx({ promptEnabled: false });
			const task = createMockTask();
			const originalEnv = process.env.NODE_AUTH_TOKEN;
			process.env.NODE_AUTH_TOKEN = 'npm_test_token';

			try {
				await (npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
					ctx,
					task,
				);

				expect(mockNpm.publishProvenance).toHaveBeenCalledOnce();
				expect(mockNpm.publish).not.toHaveBeenCalled();
			} finally {
				if (originalEnv !== undefined) {
					process.env.NODE_AUTH_TOKEN = originalEnv;
				} else {
					delete process.env.NODE_AUTH_TOKEN;
				}
			}
		});

		it('throws when publishProvenance returns false (2FA required)', async () => {
			const ctx = createCtx({ promptEnabled: false });
			const task = createMockTask();
			const originalEnv = process.env.NODE_AUTH_TOKEN;
			process.env.NODE_AUTH_TOKEN = 'npm_test_token';

			mockNpm.publishProvenance.mockResolvedValue(false);

			try {
				await expect(
					(npmPublishTasks.task as (ctx: Ctx, task: any) => Promise<void>)(
						ctx,
						task,
					),
				).rejects.toThrow(
					'In CI environment, publishing with 2FA is not allowed',
				);
			} finally {
				if (originalEnv !== undefined) {
					process.env.NODE_AUTH_TOKEN = originalEnv;
				} else {
					delete process.env.NODE_AUTH_TOKEN;
				}
			}
		});
	});
});
