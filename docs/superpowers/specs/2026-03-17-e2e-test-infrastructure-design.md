# E2E Test Infrastructure Design

## Summary

E2E 테스트 인프라를 개선하여:
1. 빌드된 바이너리 기반으로 실제 배포 환경을 검증
2. 기존 fixtures를 정리하고 재사용
3. 선언적 git 상태 구성 헬퍼 제공

## Motivation

- 현재 E2E 테스트는 `bun src/cli.ts`로 실행 — 실제 바이너리 무결성 미검증
- CI에서 bun 없이도 테스트 실행 가능해야 함
- 테스트마다 inline으로 fixture를 만들어 중복이 많고, 기존 `tests/fixtures/`가 활용되지 않음

## Architecture

3개 레이어 + facade 구조:

```
e2e() facade
  ├── FixtureManager  — fixture → temp dir 복사/삭제
  ├── GitFixture      — 빌더 패턴 git 상태 구성
  └── BinaryRunner    — 플랫폼 바이너리 resolve/실행
```

### 파일 구조

```
packages/pubm/tests/
  utils/
    e2e.ts              — facade 함수
    fixture-manager.ts  — FixtureManager 클래스
    git-fixture.ts      — GitFixture 클래스
    binary-runner.ts    — BinaryRunner 클래스
    cli.ts              — 기존 CliController (재사용)
  fixtures/             — 정리된 fixture 디렉토리들
```

## Detailed Design

### 1. e2e() Facade

테스트 파일에서의 사용:

```ts
import { e2e } from "../utils/e2e";

describe("publish flow", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("monorepo-basic");
  });

  afterAll(() => ctx.cleanup());

  it("should publish", async () => {
    await ctx.git
      .init()
      .add(".")
      .commit("initial")
      .tag("v1.0.0")
      .done();

    const { stdout, stderr, exitCode } = await ctx.run(
      "--publish-only",
      "--no-pre-check"
    );

    expect(exitCode).toBe(0);
  });
});
```

같은 `describe` 블록 내 테스트들은 동일한 temp dir을 공유합니다.
git 상태도 누적되므로, 테스트 간 독립성이 필요하면 `describe`를 분리하세요.

구현:

```ts
interface E2EContext {
  dir: string;                     // fixture temp dir 경로
  git: GitFixture;                 // git 빌더
  run(...args: string[]): Promise<RunResult>;
  runWithEnv(env: Record<string, string>, ...args: string[]): Promise<RunResult>;
  cleanup(): Promise<void>;        // temp dir 삭제
}

async function e2e(fixtureName?: string): Promise<E2EContext> {
  const fixture = await FixtureManager.create(fixtureName);
  const runner = new BinaryRunner(fixture.dir);

  return {
    get dir() { return fixture.dir; },
    get git() { return new GitFixture(fixture.dir); },
    run: (...args) => runner.run(...args),
    runWithEnv: (env, ...args) => runner.runWithEnv(env, ...args),
    cleanup: () => fixture.cleanup(),
  };
}
```

- `e2e()`는 async — `beforeAll`에서 `await`로 호출
- fixture 이름 생략 시 빈 temp dir 생성
- `dir`, `git`은 초기화 완료 후 동기적으로 접근 가능

### 2. FixtureManager

```ts
class FixtureManager {
  private tmpDir: string;

  static async create(fixtureName?: string): Promise<FixtureManager>;

  get dir(): string;

  async cleanup(): Promise<void>;
}
```

- `tests/fixtures/{name}/` → `os.tmpdir()/pubm-e2e-{name}-{timestamp}/`로 재귀 복사
- fixtureName이 없으면 빈 temp dir 생성
- fixture 디렉토리가 존재하지 않으면 에러
- `cleanup()`에서 temp dir 재귀 삭제

### 3. GitFixture

빌더 패턴으로 git 명령을 큐에 쌓고 `done()`에서 순차 실행:

```ts
class GitFixture {
  constructor(private cwd: string) {}

  init(branch?: string): this;                    // git init -b {branch}, 기본 "main"
  config(key: string, value: string): this;       // git config
  add(pathspec?: string): this;                   // git add, 기본 "."
  commit(message: string): this;                  // git commit -m
  tag(name: string): this;                        // git tag
  branch(name: string): this;                     // git checkout -b
  checkout(ref: string): this;                    // git checkout

  async done(): Promise<void>;                    // 큐 실행
}
```

- `init()` 호출 시 `user.name`/`user.email` 테스트용 기본값 자동 설정
- `done()` 후 큐는 비워짐 (재사용 가능)
- `done()`은 명령을 순차 실행하며, 첫 번째 실패 시 즉시 중단하고 실패한 명령과 stderr를 포함한 에러를 throw

### 4. BinaryRunner

```ts
// runPubmCli 반환 타입과 동일
interface RunResult {
  controller: CliController;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  waitForClose: () => Promise<unknown>;
}

class BinaryRunner {
  constructor(private cwd: string) {}

  // process.platform + process.arch → 바이너리 경로 resolve
  // 경로: path.resolve(import.meta.dir, "../../platforms", platformDir, "bin", binaryName)
  private static resolveBinaryPath(): string;

  async run(...args: string[]): Promise<RunResult>;
  async runWithEnv(env: Record<string, string>, ...args: string[]): Promise<RunResult>;
}
```

- `process.platform` + `process.arch` → 바이너리 경로 자동 resolve
  - 플랫폼 매핑: `darwin`→`darwin`, `linux`→`linux`, `win32`→`windows`
  - 아키텍처 매핑: `arm64`→`arm64`, `x64`→`x64`
  - 예: `darwin` + `arm64` → `platforms/darwin-arm64/bin/pubm`
  - `win32` → `pubm.exe` 확장자 자동 처리
- 경로 resolve: `import.meta.dir` 기준 상대 경로로 `platforms/` 디렉토리 참조
- 바이너리 미빌드 시: `"Binary not found at {path}. Run 'bun run build' first."`
- 내부적으로 기존 `runPubmCli(binaryPath, { cwd, env }, ...args)`를 위임 호출
  - `runPubmCli`의 첫 번째 인자가 임의 command를 받으므로 바이너리 경로를 그대로 전달
  - `CliController`를 통한 stdout/stderr 캡처, interactive 입력 지원 그대로 활용

### 5. Fixture 정리

기존 15개 fixture 디렉토리를 유지하되, E2E 테스트에서 활용되도록 정리:

- `.git` 디렉토리는 포함하지 않음 (git이 필요한 테스트는 `GitFixture` 사용)
- 각 fixture는 최소한의 파일만 포함 (package.json, jsr.json 등)
- E2E 테스트에서 필요한 새 fixture가 있으면 추가

### 6. 기존 E2E 테스트 마이그레이션

기존 7개 CLI E2E 테스트 + 1개 plugin E2E 테스트를 새 헬퍼로 마이그레이션:

- `runPubmCli("bun", { cwd }, "src/cli.ts", ...)` → `ctx.run(...)`
- inline fixture 생성 → 기존 fixture 참조 또는 새 fixture 추가
- inline git 초기화 → `ctx.git.init().add().commit().done()`
- temp dir 수동 생성/삭제 → `e2e()`/`cleanup()`

기존 `runPubmCli()`와 `CliController`는 삭제하지 않고 유지 (BinaryRunner 내부에서 CliController 재사용).

## Unit/Integration 테스트에서의 인메모리 FS

E2E와 별도로, unit/integration 테스트에서 인메모리 FS를 도입할 수 있음. 이는 별도 스코프로 진행.

## Testing Strategy

- `FixtureManager`, `GitFixture`, `BinaryRunner` 각각에 대한 unit 테스트 작성
- 마이그레이션된 E2E 테스트가 기존과 동일하게 통과하는지 검증
- CI에서 바이너리 빌드 후 E2E 실행하는 파이프라인 확인

## Scope

### In scope
- 3개 레이어 + facade 구현
- fixture 정리
- 기존 E2E 테스트 마이그레이션
- 바이너리 기반 실행

### Out of scope
- unit/integration 테스트의 인메모리 FS 도입 (별도 작업)
- 새로운 E2E 테스트 케이스 추가
- CI 파이프라인 변경
