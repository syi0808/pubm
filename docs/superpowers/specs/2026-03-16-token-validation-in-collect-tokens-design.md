# Token Validation in collectTokens

## Problem

`collectTokens`가 SecureStore(macOS Keychain / 암호화 DB)에서 토큰을 로드할 때 **존재 여부만** 확인하고 **유효성은 검증하지 않는다**. 만료되거나 무효한 토큰이 저장되어 있으면:

1. 프롬프트를 건너뜀 (토큰이 "있으므로")
2. 무효한 토큰을 환경변수에 주입
3. `promptEnabled = false`로 전환 (preflight 모드)
4. `checkAvailability`에서 `npm whoami` 등으로 인증 실패
5. `promptEnabled`이 false이므로 재프롬프트 불가 → 에러로 종료

사용자는 유효한 토큰을 입력할 기회 없이 실패를 경험한다.

## Solution

### 1. `RegistryDescriptor`에 `validateToken` 추가

`catalog.ts`의 `RegistryDescriptor` 인터페이스에 optional 필드 추가:

```typescript
validateToken?: (token: string) => Promise<boolean>;
```

- 토큰이 유효하면 `true`, 무효하면 `false` 반환
- 네트워크 에러 등 인프라 문제는 예외를 던져서 토큰 무효와 구분
- 미구현 레지스트리(private registry 포함)는 검증 스킵 (기존 동작 유지)

### 2. 레지스트리별 구현

모든 구현은 직접 HTTP 호출 방식을 사용하여 환경변수 오염 및 subprocess 부작용을 방지한다.

#### npm

npm registry의 `/-/whoami` 엔드포인트에 직접 HTTP 호출:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://registry.npmjs.org/-/whoami", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}
```

`npm whoami` CLI 대신 직접 HTTP를 사용하는 이유: `exec`의 env merge 방식에서 `.npmrc`에 별도 유효 세션이 있으면 false positive 가능.

#### jsr

jsr API의 `/user` 엔드포인트에 직접 HTTP 호출:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://jsr.io/api/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}
```

`JsrClient.token` static 프로퍼티를 임시 교체하는 방식 대신 직접 fetch 사용 — async 중 다른 코드가 static 값을 읽는 race condition 방지.

#### crates

crates.io API의 `/api/v1/me` 엔드포인트에 직접 HTTP 호출:

```typescript
validateToken: async (token) => {
  const res = await fetch("https://crates.io/api/v1/me", {
    headers: {
      Authorization: token,
      "User-Agent": "pubm (https://github.com/syi0808/pubm)",
    },
  });
  return res.ok;
}
```

`cargo owner --list`는 crate name 인자가 필수이므로 `collectTokens` 시점에서 사용 불가.

### 3. `collectTokens` 변경

현재 흐름:
```
loadTokensFromDb → 토큰 있으면 skip → 없으면 prompt → 저장
```

변경 후 흐름:
```
loadTokensFromDb → 토큰 있으면 validateToken 호출
  → 유효 → skip
  → 무효 → 안내("Stored token is invalid") → SecureStore에서 삭제 → prompt로 진입
  → validateToken 미구현 → skip (기존 동작)
prompt → 입력받은 토큰 validateToken 호출
  → 유효 → SecureStore에 저장 → 다음 레지스트리
  → 무효 → 안내("Token is invalid, try again") → 다시 prompt
  → validateToken 미구현 → 저장 → 다음 레지스트리
```

- 재프롬프트는 무제한 반복 (사용자가 Ctrl+C로 탈출)
- 무효한 저장 토큰은 즉시 SecureStore에서 삭제 (Ctrl+C로 중단해도 다음 실행 시 같은 문제 반복 방지)
- 새 유효 토큰은 SecureStore에 저장
- `validateToken`이 예외를 던지면 (네트워크 에러 등) 그대로 전파
- 검증 중 `task.output`에 진행 상태 표시 (예: "Validating stored npm token...")

### 4. 환경변수 토큰 처리

`loadTokensFromDb`는 환경변수(`NODE_AUTH_TOKEN`, `JSR_TOKEN`, `CARGO_REGISTRY_TOKEN`)도 확인한다. 환경변수에서 온 토큰이 무효한 경우:

- 환경변수는 프로세스 내에서 변경할 수 없으므로 재프롬프트 대신 **에러를 던진다**
- 에러 메시지에 어떤 환경변수가 무효한지 명시 (예: "NODE_AUTH_TOKEN is set but invalid")

### 5. CI 환경

CI에서는 `collectTokens`가 호출되지 않으므로 영향 없음. `checkAvailability`에서 기존대로 에러 throw.

## Scope

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/core/src/registry/catalog.ts` | `RegistryDescriptor`에 `validateToken` 필드 추가, npm/jsr/crates 각각 구현 |
| `packages/core/src/tasks/preflight.ts` | `collectTokens`에 검증 로직 추가 |

### 변경하지 않는 것

- `checkAvailability` — 기존 에러 경로 유지, fallback 재프롬프트 없음
- `runner.ts` — 기존 흐름 유지
- `loadTokensFromDb` / `token.ts` — 로딩 로직 변경 없음 (검증은 `collectTokens`에서)
- CI 동작 — 변경 없음
- Private/custom registry — `validateToken` 미구현, 기존 동작 유지 (알려진 제약)

## Error Handling

| 상황 | 동작 |
|------|------|
| 저장된 토큰 무효 (TTY) | SecureStore에서 삭제 후 재프롬프트 |
| 입력된 토큰 무효 (TTY) | 안내 후 재프롬프트 (무제한) |
| 환경변수 토큰 무효 (TTY) | 에러 throw ("ENV_VAR is set but invalid") |
| 토큰 무효 (CI) | `checkAvailability`에서 기존 에러 throw |
| `validateToken` 중 네트워크 에러 | 예외 전파 (토큰 문제와 구분) |
| `validateToken` 미구현 레지스트리 | 검증 스킵 (기존 동작) |

## Testing

- 저장된 토큰이 무효할 때 SecureStore에서 삭제되고 재프롬프트 되는지
- 입력된 토큰이 무효할 때 재프롬프트 되는지
- 유효한 토큰 입력 시 정상 진행되는지
- 환경변수 토큰이 무효할 때 적절한 에러가 발생하는지
- `validateToken` 미구현 레지스트리는 기존 동작 유지되는지
- 네트워크 에러 시 예외가 전파되는지
- CI 환경에서 기존 동작이 유지되는지
- `validateToken`은 fetch를 mock하여 테스트
