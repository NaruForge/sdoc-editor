---
applyTo: "**"
---

# Harness Engineering Guidelines — 코드 품질 강제 규칙

이 문서는 AI Agent가 코드를 작성할 때 **반드시** 준수해야 하는 규칙입니다.
위반 시 리뷰에서 반드시 지적하고 수정해야 합니다.

---

## 1. 절대 복제 금지 (Zero Duplication)

### Rule 1.1: 코드 복제 엄금
- **같은 함수/타입/상수를 2곳 이상에 정의하지 마세요.**
- 유틸리티 함수는 반드시 한 곳에 정의하고 임포트하세요.
- 위치 우선순위: `shared/` > `src/utils/` > 해당 파일 로컬

### Rule 1.2: Converter는 `shared/converter/` 단일 소스
- `src/converter/`에 파일을 만들지 마세요. Converter는 `shared/converter/`만 사용합니다.
- `src/commands/` 내보내기 커맨드는 `shared/converter/`에서 임포트하세요.
- Converter에 `vscode` API를 임포트하지 마세요.

### Rule 1.3: 인터페이스/타입은 `shared/types.ts`에 정의
- `TiptapNode`, `TiptapMark`, `SdocMeta`, `ExportSettings` 등 공유 타입은 `shared/types.ts`에서 임포트하세요.
- 파일 내에서 동일 인터페이스를 다시 선언하지 마세요.

---

## 2. 타입 안전성 (Type Safety)

### Rule 2.1: `any` 사용 금지
- `any`를 사용하지 마세요. 대안:
  - 구조를 아는 경우: 정확한 인터페이스 정의
  - 제네릭 데이터: `unknown` + 타입 가드
  - 라이브러리 타입 부재: `declare module` 또는 `@types/*` 설치
- 예외: 서드파티 라이브러리의 타입 정의가 불완전하여 우회가 불가능한 경우에만 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 주석과 함께 허용

### Rule 2.2: 메시지 프로토콜 타입 필수
- Extension ↔ Webview 간 모든 메시지는 `shared/types/messages.ts`의 discriminated union 타입을 사용하세요.
- `message.type` 문자열 리터럴을 직접 비교하지 말고 타입 가드를 사용하세요.

### Rule 2.3: `window.*` 글로벌은 타입 선언 필수
- `window.__xxx` 글로벌은 `types/globals.d.ts`에 선언된 타입만 사용하세요.
- `(window as any)` 캐스팅을 절대 사용하지 마세요.

---

## 3. 모듈 설계 (Module Design)

### Rule 3.1: 단일 책임 원칙 (SRP)
- **하나의 파일은 하나의 책임만 가집니다.**
- God Class 기준: 300줄을 넘기면 분할을 검토하세요.
- God Component 기준: 200줄을 넘기면 커스텀 훅 또는 하위 컴포넌트로 분리하세요.

### Rule 3.2: 모듈 레벨 mutable state 금지
- Converter, 유틸리티 등에서 모듈 레벨 변수(`let counter = 0`)를 사용하지 마세요.
- 대신 컨텍스트 객체를 함수 파라미터로 전달하세요:
  ```typescript
  // ❌ Bad
  let imageCounter = 0;
  function convertImage(node: TiptapNode) { imageCounter++; ... }

  // ✅ Good
  interface ConvertContext { imageCounter: number; tableCounter: number; }
  function convertImage(node: TiptapNode, ctx: ConvertContext) { ctx.imageCounter++; ... }
  ```

### Rule 3.3: 상수는 한 곳에 정의
- 매직 넘버/스트링 금지. 모든 기본값은 명명된 상수로 정의하세요.
- 기본 테마 색상, 폰트 패밀리, 캡션 접두사 등은 `shared/constants.ts` 또는 해당 유틸 모듈에 정의하세요.

---

## 4. 에러 처리 (Error Handling)

### Rule 4.1: 빈 catch 블록 금지
- `catch (e) {}` — 절대 사용하지 마세요.
- 최소한 `console.warn()`으로 기록하거나, 의도적 무시라면 `// intentionally ignored: reason` 주석을 작성하세요.

### Rule 4.2: 외부 데이터는 반드시 검증
- `JSON.parse()` 결과를 타입 캐스팅만으로 사용하지 마세요.
- 시스템 경계에서 들어오는 데이터(파일, 네트워크, 사용자 입력)는 스키마 검증 또는 타입 가드를 적용하세요.
- 추천: `zod`(이미 프로젝트에 설치됨)로 런타임 검증

---

## 5. 동기화 규칙 (Sync Rules)

### Rule 5.1: webview-ui ↔ tauri-app 동기화
- `webview-ui/src/extensions/`의 모든 변경은 `tauri-app/src/extensions/`에도 반영해야 합니다.
- 동기화 대상: extensions, 공유 컴포넌트 로직, CSS 변수
- 커밋 메시지에 `sync: tauri-app` 태그를 포함하세요.

### Rule 5.2: 의존성 패키지 버전 동기화
- `webview-ui/package.json`과 `tauri-app/package.json`의 공통 패키지는 동일 버전을 사용하세요.
- 한쪽만 업데이트하지 마세요.

---

## 6. 통신 브릿지 (Communication Bridge)

### Rule 6.1: 메시지 핸들러는 라우터 패턴
- 거대한 switch/case 또는 if/else 메시지 핸들러를 만들지 마세요.
- 타입별 핸들러 맵을 사용하세요:
  ```typescript
  // ❌ Bad
  switch (message.type) {
    case 'init': /* 30 lines */ break;
    case 'update': /* 20 lines */ break;
    // ... 11 cases
  }

  // ✅ Good
  const handlers: MessageHandlerMap = {
    init: handleInit,
    update: handleUpdate,
  };
  handlers[message.type]?.(message);
  ```

### Rule 6.2: 글로벌 브릿지 최소화
- `window.__xxx` 글로벌은 vanilla DOM NodeView ↔ React 통신에만 사용하세요.
- 새로운 글로벌 추가 시 반드시 `types/globals.d.ts`에 타입을 추가하세요.
- React 컴포넌트 간 통신에 글로벌을 사용하지 마세요 — Context 또는 props를 사용하세요.

---

## 7. 스타일 규칙 (Styling)

### Rule 7.1: 인라인 스타일 지양
- 동적 값(포지션, 크기 등) 외에는 CSS 클래스를 사용하세요.
- JS로 hover 효과를 구현하지 마세요 — CSS `:hover`를 사용하세요.

### Rule 7.2: CSS 변수 활용
- 하드코딩된 색상값을 사용하지 마세요.
- VS Code 테마: `--vscode-*` CSS 변수 사용
- Tauri: `tauri-theme.css`에 대응하는 커스텀 프로퍼티 정의

---

## 8. 성능 규칙 (Performance)

### Rule 8.1: 동기 파일 I/O 금지
- `fs.readFileSync`, `fs.writeFileSync` 등 동기 I/O는 Extension Host에서 사용하지 마세요.
- 대신 `fs.promises.*` 또는 `vscode.workspace.fs`를 사용하세요.
- 예외: Extension 활성화 시 초기 설정 파일 읽기 (1회성)

### Rule 8.2: React 렌더링 최적화
- 에디터 `transaction` 이벤트에 전체 컴포넌트를 리렌더하지 마세요.
- `React.memo`로 하위 컴포넌트를 감싸고, 필요한 상태만 선택적으로 구독하세요.
- 컴포넌트 정의를 렌더 함수 안에 넣지 마세요.

---

## 9. 프로덕션 청결 (Production Hygiene)

### Rule 9.1: `console.log` 금지
- 디버깅용 `console.log`를 커밋하지 마세요.
- 필요한 로깅은 `console.warn` 또는 `console.error`만 사용하세요.

### Rule 9.2: 데드 코드 즉시 삭제
- 사용하지 않는 파일, 임포트, 함수는 발견 즉시 삭제하세요.
- "나중에 쓸 수도 있는" 코드는 Git 히스토리에만 남기세요.

### Rule 9.3: 주석은 "왜"만 작성
- 코드가 "무엇을 하는지"는 주석 대신 명확한 이름으로 표현하세요.
- "왜 이렇게 했는지"가 명확하지 않은 경우에만 주석을 작성하세요.
