export interface Package {
	scope: string;
	name: string;
	description: string;
	runtimeCompat: RuntimeCompat;
	createdAt: string;
	updatedAt: string;
	githubRepository: GithubRepository;
	score: number;
}

export interface RuntimeCompat {
	browser: boolean;
	deno: boolean;
	node: boolean;
	workerd: boolean;
	bun: boolean;
}

export interface GithubRepository {
	owner: string;
	name: string;
}

export interface Scope {
	scope: string;
	creator: Creator;
	quotas: Quotas;
	ghActionsVerifyActor: boolean;
	requirePublishingFromCI: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface Creator {
	id: string;
	name: string;
	email: string;
	avatarUrl: string;
	githubId: number;
	isBlocked: boolean;
	isStaff: boolean;
	scopeUsage: number;
	scopeLimit: number;
	inviteCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface Quotas {
	packageUsage: number;
	packageLimit: number;
	newPackagePerWeekUsage: number;
	newPackagePerWeekLimit: number;
	publishAttemptsPerWeekUsage: number;
	publishAttemptsPerWeekLimit: number;
}

export interface UserInfo {
	id: string;
	name: string;
	email: string;
	avatarUrl: string;
	githubId: number;
	isBlocked: boolean;
	isStaff: boolean;
	scopeUsage: number;
	scopeLimit: number;
	inviteCount: number;
	createdAt: string;
	updatedAt: string;
}

export namespace JsrApi {
	export interface Packages {
		items: Package[];
		total: number;
	}

	export namespace Users {
		export type User = UserInfo;

		export type Scopes = Scope[];
	}
}
