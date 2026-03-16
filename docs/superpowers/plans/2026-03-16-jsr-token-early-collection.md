# JSR Token Early Collection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 모드(non-preflight)에서 JSR 토큰을 publish 전 단계에서 미리 수집하여 preflight 모드와 일관성을 확보한다.

**Architecture:** `runner.ts`의 일반 모드 블록에서 `prerequisitesCheckTask` 이후, `requiredConditionsCheckTask` 이전에 JSR 토큰 수집 태스크를 삽입한다. 기존 `collectTokens()`를 JSR만 필터링하여 재사용하고, 수집된 토큰은 환경변수 주입 + `JsrClient.token` 갱신으로 이후 플로우에 반영한다.

**Tech Stack:** TypeScript, listr2, vitest

**Spec:** `docs/superpowers/specs/2026-03-16-jsr-token-early-collection-design.md`

---

## Chunk 1: Error Message & Tests

### Task 1: Update `collectTokens` error message

**Files:**
- Modify: `packages/core/src/tasks/preflight.ts:44-47`
- Modify: `packages/core/tests/unit/tasks/preflight.test.ts:101-103`

- [ ] **Step 1: Write the failing test — update expected error message**

`packages/core/tests/unit/tasks/preflight.test.ts` 의 `"throws when a required token input is empty"` 테스트에서 기대 메시지를 변경:

```typescript
// 기존:
await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow(
  "npm access token is required to continue in preflight mode.",
);

// 변경:
await expect(collectTokens(["npm"], mockTask as any)).rejects.toThrow(
  "npm access token is required to continue.",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/preflight.test.ts`
Expected: FAIL — 에러 메시지에 "in preflight mode"가 포함되어 불일치

- [ ] **Step 3: Update error message in source**

`packages/core/src/tasks/preflight.ts:45-47`:

```typescript
// 기존:
throw new PreflightError(
  `${config.promptLabel} is required to continue in preflight mode.`,
);

// 변경:
throw new PreflightError(
  `${config.promptLabel} is required to continue.`,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/preflight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/preflight.ts packages/core/tests/unit/tasks/preflight.test.ts
git commit -m "refactor(core): remove preflight-specific wording from collectTokens error message"
```

---

## Chunk 2: Implementation & Tests

### Task 2: Add JSR token early collection in runner.ts

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:586-594`

- [ ] **Step 1: Add `JsrClient` import**

`packages/core/src/tasks/runner.ts` 상단에 `JsrClient` import 추가:

```typescript
import { JsrClient } from "../registry/jsr.js";
```

Note: `collectTokens`는 이미 preflight 블록에서 import됨. `collectRegistries`, `createListr`, `injectTokensToEnv`도 이미 import됨.

- [ ] **Step 2: Insert JSR token collection task in normal mode block**

`packages/core/src/tasks/runner.ts`의 일반 모드 블록 (line 586-594)을 수정:

```typescript
if (!ctx.options.publishOnly && !ctx.options.ci && !ctx.options.preflight) {
  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  // Collect JSR token early if JSR registry is configured
  const registries = collectRegistries(ctx.config);
  if (registries.includes("jsr") && ctx.runtime.promptEnabled) {
    await createListr<PubmContext>({
      title: "Ensuring JSR authentication",
      task: async (ctx, task): Promise<void> => {
        const tokens = await collectTokens(["jsr"], task);
        cleanupEnv = injectTokensToEnv(tokens);
        if (tokens.jsr) {
          JsrClient.token = tokens.jsr;
        }
      },
    }).run(ctx);
  }

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}
```

핵심 포인트:
- `collectRegistries()`로 설정된 레지스트리 확인
- `"jsr"`이 포함되어 있고 `promptEnabled`(TTY)인 경우에만 실행
- `collectTokens(["jsr"], task)` — 이미 includes 확인했으므로 직접 `["jsr"]` 전달
- `collectTokens()`는 기존에 저장된 토큰이 있으면 프롬프트를 스킵 (`preflight.ts:29`)
- `JsrClient.token`을 명시적으로 갱신 — `injectTokensToEnv()`는 `process.env.JSR_TOKEN`만 설정하고 static 프로퍼티는 갱신하지 않음
- `promptEnabled`는 변경하지 않음 (이후 버전 선택 등 인터랙티브 프롬프트 필요)

- [ ] **Step 3: Run format, typecheck, tests**

```bash
bun run format && bun run typecheck && cd packages/core && bun vitest --run
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat(core): collect JSR token before conditions check in normal mode"
```

---

### Task 3: Add tests for JSR token early collection

**Files:**
- Modify: `packages/core/tests/unit/tasks/runner.test.ts`

Note: `runner.ts`는 listr2 기반이라 통합 테스트 성격이 강함. 기존 `runner.test.ts`의 mock 패턴과 context 생성 방식을 따라 구현. 실제 테스트 구현 시 기존 테스트의 mock setup을 참조하여 작성한다.

- [ ] **Step 1: Add test — JSR token collected when jsr registry configured and promptEnabled**

`collectTokens`가 `["jsr"]`로 호출되는지, `JsrClient.token`이 갱신되는지, `injectTokensToEnv`가 호출되는지 검증.

- [ ] **Step 2: Add test — JSR token collection skipped when jsr not in registries**

레지스트리에 npm만 설정된 경우 `collectTokens`가 호출되지 않는지 검증.

- [ ] **Step 3: Add test — JSR token collection skipped when promptEnabled is false**

`ctx.runtime.promptEnabled = false`(CI 모드) 상태에서 `collectTokens`가 호출되지 않는지 검증.

- [ ] **Step 4: Add test — existing JSR token skips prompt**

`loadTokensFromDb`가 `{ jsr: "existing-token" }`을 반환할 때 프롬프트 없이 토큰이 사용되는지 검증.

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/tests/unit/tasks/runner.test.ts
git commit -m "test(core): add tests for JSR token early collection in normal mode"
```

---

## Chunk 3: Final Verification

### Task 4: Full verification

- [ ] **Step 1: Format check**

Run: `bun run format`

- [ ] **Step 2: Type check**

Run: `bun run typecheck`

- [ ] **Step 3: Full test suite**

Run: `bun run test`

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "fix(core): address lint/type issues from JSR token early collection"
```

(이 커밋은 이슈가 있을 때만 생성)
