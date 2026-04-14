---
ats: "0.1"
id: SDOC-031
title: "버그 수정 — 저장 시 내용 소실 + 블록 객체 간 텍스트 삽입 불가"
status: done
priority: high
created: 2026-04-14T22:00:00+09:00
modified: 2026-04-14T23:00:00+09:00
author: "@copilot"
---

# SDOC-031: 버그 분석 — 저장 시 내용 소실 + 블록 객체 간 텍스트 삽입 불가

## Context

사용자가 보고한 두 가지 버그:
1. **저장 시 내용 소실**: 작성 직후 Ctrl+S로 저장하면 방금 입력한 내용이 사라지는 현상
2. **블록 객체 간 텍스트 삽입 불가**: 인용문(blockquote)이나 callout 등 블록 객체 뒤에서 Enter를 눌러도 일반 텍스트 줄로 빠져나오지 못함

## Scope

### In Scope
- 저장 메커니즘의 race condition 근본 원인 분석
- 블록 객체 탈출 키보드 동작 분석
- 수정 방안 설계

### Out of Scope
- 실제 코드 수정 (별도 태스크로 분리)

---

## Bug 1 분석: 저장 시 입력 내용 소실

### 전체 저장 플로우

```
[Webview]                              [Extension Host]                    [Disk]
   │                                        │                               │
   │ 사용자 입력 → Tiptap onUpdate          │                               │
   │   └─ 300ms 디바운스 타이머 시작        │                               │
   │                                        │                               │
   │ Ctrl+S 키다운:                         │                               │
   │   ├─ flushUpdate()                     │                               │
   │   │   ├─ clearTimeout(debounce)        │                               │
   │   │   ├─ editor.getJSON() → 최신 상태  │                               │
   │   │   ├─ pendingEditRef = true         │                               │
   │   │   └─ postMessage({type:'edit'})  ──┼─→ (IPC 비동기 전달)           │
   │   │                                    │                               │
   │   └─ VS Code Ctrl+S 전파  ────────────┼──→ document.save()  ─────────→│ 파일 쓰기
   │                                        │    (구 TextDocument 내용)      │ (구 내용!)
   │                                        │                               │
   │                                        │ ← 'edit' 메시지 수신          │
   │                                        │   updateDocument()            │
   │                                        │     applyEdit()               │
   │                                        │     → TextDocument 갱신       │
   │                                        │     → dirty 상태로 전환       │
```

### 근본 원인 1: Ctrl+S 비동기 경쟁 (Race Condition)

**파일**: `webview-ui/src/hooks/useTiptapEditor.ts` (72-81행)

```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    flushUpdate();  // postMessage는 비동기 IPC
  }
};
```

`flushUpdate()`가 `postMessage()`로 최신 상태를 보내지만, 이 메시지 전달은 **비동기 IPC**이다.
동시에 VS Code의 `Ctrl+S` 키바인딩은 `document.save()`를 실행하여 **현재 TextDocument 내용**(아직 최신 편집이 반영되지 않은 상태)을 디스크에 쓴다.

**시퀀스 (문제 발생)**:
1. `flushUpdate()` → `postMessage({type: 'edit', content: 최신})` (비동기 큐잉)
2. VS Code `document.save()` → 구 TextDocument 내용을 디스크에 기록
3. Extension Host가 'edit' 메시지 수신 → `updateDocument()` → `applyEdit()` → TextDocument 갱신
4. TextDocument는 dirty 상태가 되지만, 디스크에는 구 내용이 저장됨

**결과**: 사용자가 저장했다고 생각하지만, 최신 입력은 디스크에 반영되지 않음. 파일을 닫고 다시 열면 내용이 사라져 있음.

### 근본 원인 2: `pendingApplyEdits` 카운터가 모든 문서에 공유됨

**파일**: `src/SdocEditorProvider.ts` (39행)

```typescript
export class SdocEditorProvider implements vscode.CustomTextEditorProvider {
  private pendingApplyEdits = 0;  // ← 인스턴스 레벨 (모든 문서 공유)
```

`SdocEditorProvider`는 싱글턴이므로 `pendingApplyEdits`는 열려 있는 **모든 .sdoc 문서**가 공유한다.
각 문서의 `onDidChangeTextDocument` 핸들러는 URI를 확인하지만, 카운터는 어떤 문서가 증가시켰는지 구분하지 않고 차감한다.

**시퀀스 (문제 발생, 복수 문서 열림)**:
1. DocA edit → `pendingApplyEdits = 1`
2. DocB 외부 변경 → DocB 핸들러가 URI 일치 확인 → `pendingApplyEdits > 0` → **잘못된 억제!** → `pendingApplyEdits = 0`
3. DocA `onDidChangeTextDocument` 발생 → `pendingApplyEdits = 0` → 억제되지 않음 → DocA webview에 'update' 전송

### 근본 원인 3: `pendingEditRef`가 boolean (카운터가 아님)

**파일**: `webview-ui/src/components/Editor.tsx` (38행), `webview-ui/src/hooks/useEditorMessages.ts` (61-64행)

```typescript
// Editor.tsx
const pendingEditRef = useRef(false);  // boolean, 카운터가 아님

// useEditorMessages.ts
case 'update':
  if (pendingEditRef.current) {
    pendingEditRef.current = false;  // 1회 소비
    break;
  }
  setContentRef.current(message.content);  // webview 내용 교체!
```

`pendingEditRef`는 `true`/`false` 토글이므로 **하나의** 'update' 메시지만 억제한다.
Save participant(JSON formatter, linter 등)이 저장 과정에서 문서를 수정하면 추가 `onDidChangeTextDocument`가 발생하고, 첫 번째 'update'는 억제되지만 두 번째 'update'는 통과하여 webview 내용을 구 상태로 교체할 수 있다.

### 수정 방안

| 원인 | 수정 방법 | 난이도 |
|------|----------|--------|
| RC1: Ctrl+S 경쟁 | `flushUpdate()`에서 `await` 가능한 "편집 완료 확인" 패턴 도입, 또는 Extension 측에서 save 전 pending edit 처리 보장 (`vscode.workspace.onWillSaveTextDocument` 활용) | 중 |
| RC2: 공유 카운터 | `pendingApplyEdits`를 문서 URI별 `Map<string, number>`로 변경 | 하 |
| RC3: boolean 가드 | `pendingEditRef`를 숫자 카운터로 변경, 또는 "마지막으로 보낸 편집 ID"와 'update' 메시지를 매칭하는 방식 | 중 |

---

## Bug 2 분석: 블록 객체 간 일반 텍스트 삽입 불가

### 현재 동작

| 확장 | Enter 동작 | 탈출 방법 |
|------|-----------|----------|
| Blockquote (StarterKit 기본) | blockquote 내부에 새 paragraph 생성 | Backspace(첫 문자 위치) 또는 빈 줄에서 Enter |
| Callout (커스텀 NodeView) | callout 내부에 새 paragraph 생성 | `Mod-Enter` (Ctrl+Enter) |

### 문제점

1. **Blockquote**: Tiptap의 기본 Blockquote는 빈 줄에서 Enter를 누르면 탈출해야 하지만, `content: 'block+'` 스키마 상 내부에 여러 블록을 허용하므로 빈 paragraph가 블록 안에 생성됨
2. **Callout**: `defining: true` 속성으로 인해 ProseMirror의 기본 lift 동작이 차단됨. 유일한 탈출 방법이 `Mod-Enter`이지만, 사용자에게 발견 가능성(discoverability)이 매우 낮음
3. **두 블록 사이**: 두 연속 blockquote/callout 사이에 커서를 놓을 수 없음. GapCursor는 StarterKit에 포함되어 있지만, GapCursor에서 Enter를 눌러 일반 paragraph를 삽입하는 기본 동작이 없을 수 있음

### 근본 원인

ProseMirror/Tiptap의 기본 동작에서 **wrapped 블록 노드(blockquote, callout 등)**는 Enter 키로 내부 콘텐츠만 확장할 뿐, 노드 **밖**으로 커서를 이동시키는 기본 메커니즘이 제한적이다.

특히:
- `defining: true`인 Callout은 ProseMirror의 `lift` 커맨드 대상에서 제외됨
- Blockquote의 "빈 Enter로 탈출" 동작은 마지막 paragraph가 비어있을 때만 동작하며, 블록 중간에서는 작동하지 않음
- 연속된 블록 노드 사이에는 GapCursor가 표시되지만, 해당 위치에서 텍스트 입력으로 paragraph가 자동 생성되지 않을 수 있음

### 수정 방안

| 접근법 | 설명 | 난이도 |
|--------|------|--------|
| A. Blockquote에 커스텀 Enter 핸들러 추가 | 마지막 빈 paragraph에서 Enter → paragraph를 blockquote 밖으로 lift | 하 |
| B. Callout에 Enter+Backspace 핸들러 추가 | 빈 첫 paragraph에서 Backspace → callout 해제, 마지막 빈 paragraph에서 Enter → 탈출 | 중 |
| C. GapCursor에서 텍스트 입력 시 paragraph 자동 삽입 | GapCursor 위치에서 아무 키나 누르면 paragraph 생성 후 입력 시작 | 중 |
| D. 모든 블록 노드에 공통 "탈출" 키보드 단축키 통일 | Enter(빈 줄) → 탈출, Mod-Enter → 즉시 탈출 (Callout, Blockquote 공통) | 하 |

**권장**: D → A + B 순서로 구현. 공통 패턴을 먼저 정립한 후 각 노드에 적용.

## Progress
- [x] 저장 메커니즘 전체 플로우 분석
- [x] Race condition 근본 원인 식별
- [x] `pendingApplyEdits` 공유 카운터 문제 확인
- [x] `pendingEditRef` boolean 가드 한계 확인
- [x] Blockquote/Callout Enter 키 동작 분석
- [x] 수정 방안 설계
- [x] RC1 수정: `onWillSaveTextDocument` + `requestFlush` + `saveRequested` 3중 보호
- [x] RC2 수정: `pendingApplyEdits`를 `Map<string, number>`로 문서별 분리
- [x] RC3 수정: `pendingEditRef`를 boolean → number 카운터로 변경
- [x] Bug2 수정: `BlockExit` 확장 추가 (Enter/Backspace 탈출)
- [x] tauri-app 동기화
- [x] 빌드 검증

## 검증 항목

### 자동 검증 완료
- [x] `npm run build` 성공 (extension + webview 모두)
- [x] webview-ui `tsc --noEmit` 통과 (타입 에러 없음)
- [x] root `tsc --noEmit` — 제 변경과 무관한 기존 에러만 존재

### 사용자 수동 검증 필요

#### Bug 1: 저장 시 내용 소실
1. **기본 저장 테스트**: .sdoc 파일에 텍스트 입력 후 즉시 Ctrl+S → 파일을 닫고 다시 열어 내용이 보존되는지 확인
2. **빠른 연속 입력 후 저장**: 여러 줄을 빠르게 입력(300ms 이내)하고 즉시 Ctrl+S → 모든 입력이 저장되는지 확인
3. **복수 문서 동시 편집**: .sdoc 파일 2개를 동시에 열고, 각각 편집 후 Ctrl+S → 양쪽 문서의 내용이 올바르게 저장되는지 확인
4. **auto-save 시나리오**: VS Code auto-save 활성화 후 편집 → 저장 후 dirty 표시가 올바르게 해제되는지 확인
5. **Command Palette 저장**: Ctrl+Shift+P → "Save" 명령으로 저장 → 내용 보존 확인

#### Bug 2: 블록 객체 탈출
6. **Blockquote Enter 탈출**: 인용문 내부에서 빈 줄 생성 후 Enter → 인용문 밖으로 커서가 이동하는지 확인
7. **Blockquote Backspace 해제**: 인용문의 첫 줄이 빈 상태에서 Backspace → 인용문이 해제(일반 텍스트로 변환)되는지 확인
8. **Callout Enter 탈출**: Callout 내부에서 빈 줄 생성 후 Enter → Callout 밖으로 커서가 이동하는지 확인
9. **Callout Backspace 해제**: Callout의 첫 줄이 빈 상태에서 Backspace → Callout이 해제되는지 확인
10. **Callout Mod-Enter**: 기존 Ctrl+Enter 탈출도 여전히 동작하는지 확인
11. **연속 블록 사이 입력**: 인용문 2개가 연속된 상태에서 첫 인용문 마지막에서 Enter → 인용문 사이에 일반 텍스트 줄이 생기는지 확인
12. **블록 중간 Enter**: 인용문/Callout 중간의 빈 줄에서 Enter → 블록 밖으로 나가지 않고 내부에 머무르는지 확인 (의도적 동작)
