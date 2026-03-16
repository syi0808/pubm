# JSR Token Early Collection Design

## Context

현재 pubm의 토큰 수집 시점이 모드에 따라 불일치한다:

- **Preflight 모드**: `collectTokens()`로 publish 전 첫 단계에서 모든 레지스트리 토큰을 일괄 수집
- **일반 모드**: 각 레지스트리 publish task에서 개별적으로 토큰을 체크하며, JSR은 publish 시점에서야 토큰 부재를 감지

JSR은 publish 시 `--token` 플래그가 필수이므로, 일반 모드에서도 토큰이 없으면 publish 단계에서 실패한다. 이때 이미 version bump, git commit/tag 등이 완료된 상태라 롤백이 필요해진다.

또한 `checkAvailability()` 단계에서도 JSR API 호출(`scopes()`, `hasPermission()`, `package()`)이 `JsrClient.token`을 `Authorization` 헤더에 사용하므로, 토큰이 없으면 conditions check 자체가 부정확한 결과(401 → null/empty 반환)를 낸다.

이 변경은 일반 모드에서도 JSR 토큰을 publish 전에 미리 수집하여, 토큰 부재로 인한 불필요한 롤백과 부정확한 conditions check를 방지하고 preflight 모드와의 일관성을 확보한다.

## Scope

- JSR 토큰만 대상. npm은 `npm login` 기반 인증, crates는 `cargo` CLI 위임으로 기존 플로우 유지.
- 일반 모드(non-preflight)의 TTY 환경에서 JSR 토큰이 없을 때 프롬프트로 수집하여 SecureStore에 저장.
- CI 환경에서는 `JSR_TOKEN` 환경변수가 필수이며, 없으면 기존처럼 에러.
- `publishOnly` 모드와 snapshot 모드는 이번 스코프에서 제외. 이 모드들은 별도의 토큰 관리 흐름을 가지며, 추후 필요 시 확장.

## Design

### 변경할 파일

#### 1. `packages/core/src/tasks/runner.ts`

일반 모드 블록(non-preflight, non-CI) 내에서 `prerequisitesCheckTask` 이후, `requiredConditionsCheckTask` 이전에 JSR 토큰 수집 태스크를 삽입한다.

```
기존 흐름:
  prerequisites → conditions check → ... → publish (JSR 토큰 체크)

변경 흐름:
  prerequisites → JSR 토큰 수집/검증 → conditions check → ... → publish (통과)
```

구체적으로:
- 설정된 레지스트리 목록에서 JSR이 포함되어 있는지 확인
- JSR이 있고 `promptEnabled`(TTY)이면: 새로운 listr task("Ensuring JSR authentication")를 생성하여 `collectTokens()`를 JSR 레지스트리만 대상으로 호출
- 수집된 토큰을 `injectTokensToEnv()`로 환경에 주입
- **`JsrClient.token`을 명시적으로 갱신** (`JsrClient.token = token`) — `injectTokensToEnv()`는 `process.env`만 설정하므로, static 프로퍼티는 별도 갱신 필요
- `promptEnabled`는 `true` 유지 (이후 버전 선택 등 인터랙티브 프롬프트가 필요)

#### 2. `packages/core/src/tasks/preflight.ts`

`collectTokens()`의 에러 메시지에서 "preflight mode" 문구를 일반적인 표현으로 변경. 이제 일반 모드에서도 호출되므로 모드에 종속적이지 않은 메시지가 필요.

#### 3. `packages/core/src/tasks/jsr.ts`

기존 토큰 체크 로직(`if (!JsrClient.token && !ctx.runtime.promptEnabled)`)은 CI용 안전장치로 유지. 일반 모드에서는 이미 토큰이 주입된 상태이므로 이 체크를 통과한다.

### 동작 시나리오

| 모드 | JSR 토큰 있음 | JSR 토큰 없음 |
|------|-------------|-------------|
| Preflight (TTY) | 스킵 | 프롬프트 수집 → 저장 |
| 일반 (TTY) | 스킵 | 프롬프트 수집 → 저장 (신규) |
| CI | 환경변수 사용 | 에러 (기존 동작 유지) |
| publishOnly / snapshot | 기존 동작 유지 (스코프 외) | 기존 동작 유지 (스코프 외) |

## Verification

1. **일반 모드 + JSR 레지스트리 + 토큰 없음**: "Ensuring JSR authentication" 태스크에서 토큰 프롬프트가 표시되는지 확인
2. **일반 모드 + JSR 레지스트리 + 토큰 있음**: 프롬프트 없이 정상 진행되는지 확인
3. **Preflight 모드**: 기존 동작과 동일한지 확인 (에러 메시지 문구만 변경)
4. **CI 모드 + JSR_TOKEN 미설정**: 기존 에러 메시지가 유지되는지 확인
5. **JSR 미포함 설정**: 토큰 수집 로직이 실행되지 않는지 확인
6. **`JsrClient.token` 갱신 확인**: 수집 후 `checkAvailability()` API 호출이 정상 동작하는지 확인
7. 기존 테스트 통과: `cd packages/core && bun vitest --run`
