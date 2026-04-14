---
ats: "0.1"
id: SDOC-035
title: "마우스 뒤로가기 버튼 → 이전 커서 위치 복원 (Cursor History Navigation)"
status: in-progress
priority: low
created: 2026-04-14T11:30:00+09:00
modified: 2026-04-14T12:00:00+09:00
author: "@copilot"
---

# SDOC-035: 마우스 뒤로가기 버튼 → 이전 커서 위치 복원

## Context

VS Code의 native `Go Back` (Alt+Left / 마우스 Button4) 기능처럼,
사용자가 마우스 사이드 버튼(뒤로가기 = Button 4, 앞으로가기 = Button 5)을 누를 때
에디터 내에서 **이전 커서 위치로 이동**하는 기능 구현 가능성 분석.

**왜 VS Code Native가 안 되는가?**
Custom Editor(webview 기반)는 VS Code의 기본 텍스트 에디터 `TextDocument` 커서 히스토리와 **분리된 별도 DOM 환경**에서 동작함.
VS Code의 "Navigate Back" 명령은 `TextEditor` 기반에만 적용되며,
Custom Webview 내부의 ProseMirror 커서 위치는 VS Code가 인식할 수 없음.

---

## 난이도 분석: ★★☆ (중간)

### 구현 구성 요소

#### 1. 마우스 Button4/Button5 이벤트 캡처 [난이도: ★☆☆]
```javascript
// webview-ui/src/components/Editor.tsx
document.addEventListener('mousedown', (e) => {
  if (e.button === 3) navigateBack();   // Browser: Button4 (뒤로)
  if (e.button === 4) navigateForward(); // Browser: Button5 (앞으로)
});
```
- `MouseEvent.button` 값: 3 = 뒤로가기, 4 = 앞으로가기
- **주의**: webview DOM 레벨에서 캡처 필요 (React 이벤트는 button 3/4 도달 전에 브라우저가 먼저 소비할 수 있음)
- `e.preventDefault()`로 VS Code 기본 동작(파일 닫기 등) 차단 필요
- webview `allowScripts: true`이므로 이벤트 캡처 자체는 가능

#### 2. 커서 위치 히스토리 스택 관리 [난이도: ★★☆]
```typescript
// 히스토리 항목
interface CursorHistoryEntry {
  from: number;
  to: number;
  docVersion: number; // 문서 수정 여부 추적
}

const MAX_HISTORY = 50;
let cursorHistory: CursorHistoryEntry[] = [];
let historyIndex = -1;
```
- ProseMirror `transaction` 이벤트에서 커서 위치 변화 추적
- **핵심 문제**: "의미 있는" 이동만 기록해야 함 (타이핑 중 매 글자마다 기록 → 불필요)
  - 의미 있는 이동 기준:
    - 마우스 클릭으로 커서 이동
    - 교차 참조 점프 (`@`링크 클릭)
    - 200자 이상 이동 (키보드 Ctrl+G, 섹션 이동 등)
  - `transaction.getMeta('pointer')` (ProseMirror 마우스 클릭 메타) 활용 가능

#### 3. ProseMirror Plugin으로 히스토리 트래킹 [난이도: ★★☆]
```typescript
import { Plugin, PluginKey } from '@tiptap/pm/state';

const cursorHistoryPlugin = new Plugin({
  key: new PluginKey('cursorHistory'),
  state: {
    init: () => ({ history: [], index: -1 }),
    apply(tr, prev) {
      // tr.getMeta('pointer') → 마우스 클릭 이동
      // tr.selectionSet && tr.docChanged → 큰 이동
      if (tr.getMeta('pointer') || isSignificantMove(tr, prev)) {
        return appendHistory(prev, tr.selection);
      }
      return prev;
    }
  }
});
```
- Tiptap Extension으로 감싸면 기존 아키텍처와 자연스럽게 통합
- `editor.chain().focus().setTextSelection(pos).run()` 으로 복원

#### 4. 문서 수정 시 히스토리 위치 보정 [난이도: ★★★]
- 사용자가 텍스트를 추가/삭제하면 position 번호가 변함
- ProseMirror `Mapping` 객체로 구버전 position → 현재 문서 position 매핑 필요
- `tr.mapping.map(oldPos)` 활용 (단, 삭제된 범위는 처리 불가)
- **이 부분이 가장 복잡한 구현 포인트**

### 제약사항 및 위험 요소

| 항목 | 내용 |
|---|---|
| Button 3/4 이벤트 차단 | VS Code 자체가 webview의 Button4를 먼저 잡아갈 수 있음 |
| position 무효화 | 텍스트 삭제 후 이전 position은 유효하지 않을 수 있음 |
| 타이핑 중 불필요 기록 | "의미 있는 이동" 필터링 로직 정교성이 사용자 경험 결정 |
| webview 재로드 | 문서 재열기 시 히스토리 소멸 (localStorage 저장은 position이 재로드 후 의미 없음) |

### VS Code 이벤트 가로채기 가능성
VS Code는 webview Button4 이벤트를 **기본적으로 "Navigate Back" 명령으로 처리**함.
이를 webview 내에서 먼저 캡처하려면:
- `document.addEventListener('mousedown', handler, { capture: true })` — 캡처 단계 사용
- VS Code Webview API에 이벤트를 소비하면 상위 VS Code로 전파되지 않도록 `e.stopPropagation()` + `e.preventDefault()` 필요
- **실험적**: webview 내 `capture: true` 핸들러가 VS Code native보다 먼저 실행되는지 확인 필요

---

## 결론 및 권고

**구현 난이도: ★★☆ (중간)**

- ProseMirror 플러그인 + 마우스 이벤트 캡처 = 핵심 로직 100~150줄 내외
- 가장 어려운 부분은 **"의미 있는 이동" 기준 정의** + **position 매핑 보정**
- VS Code가 Button4를 먼저 소비하는지 여부가 **구현 가능성의 최대 변수**
  - 불가능 시 대안: `Alt+Left` / `Alt+Right` 키보드 단축키로 동일 기능 제공

**추천 접근법**:
1. TiptapExtension `CursorHistory` 구현 (마우스 클릭 + 중요 이동만 기록)
2. Button4/5 mousedown 캡처 이벤트로 내부 이동 실행
3. 동시에 `Alt+Left`/`Alt+Right` 키보드 단축키 연동

---

## Scope

### In Scope
- `CursorHistoryExtension` Tiptap 플러그인 (히스토리 스택 관리)
- Button 3/4 이벤트 캡처 + `e.preventDefault()`
- `Alt+Left` / `Alt+Right` 키보드 단축키 폴백
- webview-ui 구현 (extension host 변경 불필요)

### Out of Scope
- VS Code의 문서 간 네비게이션과 통합
- 히스토리 영속화 (재열기 후 복원)

## Progress
- [x] 기술 분석 완료
- [x] VS Code Button4 이벤트 콘케처 구현 (capture: true)
- [x] CursorHistoryExtension Tiptap Plugin 구현
- [x] Alt+Left / Alt+Right 키보드 단쳕키 연동
- [x] tauri-app 동기화
- [x] 빌드 확인
- [x] 버그 수정: 커서 이동 후 뷰포트가 따라가지 않는 문제 (scrollCursorIntoViewArea fallback)
