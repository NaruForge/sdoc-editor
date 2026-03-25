# Plan: Structured Doc Editor — VS Code Extension

## TL;DR
`.sdoc`(JSON) 파일을 React+Tiptap WYSIWYG 에디터로 편집하고, 저장 시 `.adoc`(AsciiDoc) 파일을 자동 생성하는 VS Code Custom Editor Extension.
Monorepo(npm workspaces)로 Extension / Webview를 분리하고, CustomTextEditorProvider로 양방향 동기화 + Undo/Redo를 VS Code 히스토리에 통합.

## Architecture Decisions
- **Monorepo**: npm workspaces — root = extension, `webview-ui/` = React app
- **Package Manager**: npm
- **Bundling**: esbuild (extension), Vite (webview)
- **Conversion**: Custom Tiptap JSON → AsciiDoc 변환기 + asciidoctor.js로 round-trip 검증
- **State**: React Context + useReducer (Webview 내부 상태관리)
- **Undo/Redo**: WorkspaceEdit API로 모든 편집을 VS Code undo stack에 등록

## Project Structure

```
vscode-ext-customeditor/
├── .vscode/
│   ├── launch.json                 # Extension Development Host 설정
│   └── tasks.json                  # 빌드 태스크 (watch-ext, watch-webview)
├── package.json                    # Extension manifest + workspaces: ["webview-ui"]
├── tsconfig.json                   # Extension TypeScript config
├── esbuild.mjs                     # Extension bundler (Node target)
├── src/
│   ├── extension.ts                # activate(): provider 등록
│   ├── SdocEditorProvider.ts       # CustomTextEditorProvider 구현
│   ├── converter/
│   │   └── jsonToAdoc.ts           # Tiptap JSON → AsciiDoc 변환
│   └── utils/
│       └── webviewHelper.ts        # getNonce(), getWebviewUri() 헬퍼
├── webview-ui/
│   ├── package.json                # React, Tiptap, Tailwind 의존성
│   ├── tsconfig.json
│   ├── vite.config.ts              # build.outDir → ../dist/webview
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx                # ReactDOM.createRoot 엔트리
│       ├── App.tsx                 # EditorProvider 래핑
│       ├── components/
│       │   ├── Editor.tsx          # Tiptap EditorContent 래핑
│       │   └── Toolbar.tsx         # 포맷팅 툴바 (isActive 반영)
│       ├── hooks/
│       │   ├── useVSCodeMessaging.ts   # postMessage 추상화
│       │   └── useTiptapEditor.ts      # useEditor() + 확장 설정
│       ├── context/
│       │   └── EditorContext.tsx    # useReducer 기반 상태관리
│       ├── extensions/
│       │   └── tiptapExtensions.ts # StarterKit + Table + Underline 등
│       └── styles/
│           └── vscode-theme.css    # VS Code CSS 변수 매핑
├── sample/
│   └── example.sdoc                # 테스트용 샘플 JSON
└── README.md
```

## Phases

---

### Phase 1: Project Scaffolding & Build Pipeline

1. **루트 package.json 생성** — npm workspaces 설정, extension manifest (contributes.customEditors, activationEvents), devDependencies (esbuild, @types/vscode, typescript)
2. **esbuild.mjs 작성** — `src/extension.ts` → `dist/extension.js` (Node, external: vscode)
3. **webview-ui/ 초기화** — `npm create vite@latest` (React + TypeScript 템플릿), Tailwind CSS + PostCSS 설정
4. **Vite 설정** — `build.outDir: '../dist/webview'`, `base: ''` (상대 경로), `build.rollupOptions.output` 고정 파일명 (해시 제거)
5. **tsconfig.json** — Extension: `module: "commonjs"`, target `es2022` / Webview: `module: "esnext"`, JSX 활성화
6. **.vscode/launch.json** — Extension Development Host 프로필, `preLaunchTask` 로 빌드 태스크 연결
7. **.vscode/tasks.json** — `watch-ext` (esbuild --watch), `watch-webview` (vite build --watch) 병렬 실행

> *Phase 1 완료 기준*: `npm run build` 로 `dist/extension.js` + `dist/webview/index.html` 생성 확인

---

### Phase 2: Extension Core — CustomTextEditorProvider

8. **extension.ts** — `activate()`에서 `SdocEditorProvider.register(context)` 호출
9. **SdocEditorProvider 클래스** 구현:
   - `resolveCustomTextEditor(document, webviewPanel)`:
     a. Webview 옵션: `enableScripts: true`, `localResourceRoots` 설정
     b. HTML 생성: `dist/webview/` 에셋을 `webview.asWebviewUri()`로 변환하여 주입
     c. CSP(Content Security Policy) 설정: nonce 기반 script 허용
   - **Document → Webview 동기화**:
     a. 초기 로드: document.getText() → JSON.parse → `{ type: 'init', content }` 메시지 전송
     b. `onDidChangeTextDocument` 리스너: 외부 변경(Git checkout, 다른 에디터) 감지 → `{ type: 'update', content }` 전송
     c. echo-loop 방지: `isApplyingEdit` 플래그로 자체 변경 무시
   - **Webview → Document 동기화**:
     a. `webview.onDidReceiveMessage` 에서 `{ type: 'edit', content }` 수신
     b. `vscode.WorkspaceEdit`로 전체 문서 내용 교체 → VS Code undo stack에 자동 등록
   - **Undo/Redo 통합**:
     a. VS Code Undo → `onDidChangeTextDocument` 발생 → 변경된 JSON을 webview에 전송
     b. Webview는 수신한 JSON으로 `editor.commands.setContent()` 호출 (Tiptap 내부 히스토리 비활성화)

10. **webviewHelper.ts** — `getNonce()` (CSP용), `getWebviewUri()` 유틸리티

> *Phase 2 완료 기준*: `.sdoc` 파일을 열면 빈 Webview가 표시되고, document 내용이 메시지로 전달됨

---

### Phase 3: Webview UI — Tiptap WYSIWYG Editor

11. **tiptapExtensions.ts** — 확장 목록 구성:
    - `StarterKit` (Heading, BulletList, OrderedList, CodeBlock, Bold, Italic 포함)
    - `@tiptap/extension-underline`
    - `@tiptap/extension-table`, `TableRow`, `TableCell`, `TableHeader`
    - `History` 확장 **비활성화** (VS Code undo로 대체)

12. **useTiptapEditor.ts** — `useEditor()` 훅:
    - extensions 주입
    - `onUpdate({ editor })` → debounce(300ms) → `postMessage({ type: 'edit', content: editor.getJSON() })`
    - 외부에서 `setContent(json)` 호출 시 `onUpdate` 발동 방지 (`skipUpdate` ref 활용)

13. **useVSCodeMessaging.ts** — `window.addEventListener('message')` 래퍼:
    - `init` / `update` 메시지 수신 → EditorContext의 dispatch 호출
    - `acquireVsCodeApi()` 캐싱

14. **EditorContext.tsx** — `useReducer` 기반:
    - State: `{ doc: JSONContent | null, isReady: boolean }`
    - Actions: `SET_DOC`, `SET_READY`

15. **Editor.tsx** — `<EditorContent editor={editor} />` + 초기화 로직:
    - context에서 doc 수신 시 `editor.commands.setContent(doc)` 호출

16. **Toolbar.tsx** — 포맷팅 버튼 구현:
    - Bold, Italic, Underline, H1~H3, BulletList, OrderedList, CodeBlock, Table (Insert/Delete)
    - 각 버튼: `editor.isActive('bold')` 등으로 활성 상태 → Tailwind 클래스 토글
    - Lucide React 아이콘 사용 (Bold, Italic, Underline, List, ListOrdered, Code, Table2 등)

17. **vscode-theme.css** — VS Code CSS 변수 매핑:
    - `--vscode-editor-background` → 에디터 배경
    - `--vscode-editor-foreground` → 텍스트 색상
    - `--vscode-button-background` → 툴바 버튼
    - `--vscode-focusBorder` → 포커스 링
    - Tailwind의 CSS 변수 연동: `theme.extend.colors`에 vscode 변수 등록

> *Phase 3 완료 기준*: `.sdoc` 파일 열기 → JSON 내용이 WYSIWYG로 렌더링, 편집 → Ctrl+S → JSON 저장, Undo/Redo 정상 동작

---

### Phase 4: Save Pipeline — JSON → AsciiDoc 자동 변환

18. **jsonToAdoc.ts** — Tiptap JSON → AsciiDoc 변환기:
    - 재귀 노드 순회 함수 `convertNode(node): string`
    - 지원 노드 매핑:
      | Tiptap Node       | AsciiDoc Output          |
      |-------------------|--------------------------|
      | `heading` (level) | `== Text` ~ `==== Text` |
      | `paragraph`       | `Text\n\n`              |
      | `bulletList`      | `* Item`                |
      | `orderedList`     | `. Item`                |
      | `codeBlock`       | `[source]\n----\n...\n----` |
      | `table`           | `\|===\n\|Cell\n\|===`   |
    - 마크 처리:
      | Mark          | AsciiDoc  |
      |---------------|-----------|
      | `bold`        | `*text*`  |
      | `italic`      | `_text_`  |
      | `underline`   | `[.underline]#text#` |
    - asciidoctor.js로 생성된 AsciiDoc 파싱 → 에러 검출 (round-trip 검증, optional)

19. **Save Hook 구현** — `SdocEditorProvider` 내:
    - `vscode.workspace.onDidSaveTextDocument` 리스너
    - `.sdoc` 파일 저장 감지 → JSON 파싱 → `jsonToAdoc()` 호출
    - `vscode.workspace.fs.writeFile()` 로 동일 경로의 `.adoc` 파일 생성/업데이트
    - 에러 시 `vscode.window.showWarningMessage()` 표시

> *Phase 4 완료 기준*: `.sdoc` 저장 시 동일 디렉토리에 `.adoc` 파일이 생성되고, 내용이 올바른 AsciiDoc 형식

---

### Phase 5: Polish & Edge Cases

20. **sample/example.sdoc** — 모든 노드 타입을 포함하는 샘플 JSON 파일 작성
21. **빈 문서 처리** — 새 `.sdoc` 파일 생성 시 기본 빈 Tiptap JSON 구조 삽입
22. **대용량 문서** — 메시지 크기 제한 고려, JSON.stringify/parse 성능 확인
23. **다중 패널** — 동일 `.sdoc` 파일을 여러 탭에서 열었을 때 동기화 (webviewPanels 배열 관리)
24. **에러 핸들링** — 잘못된 JSON 파일 열기 시 사용자 친화적 에러 메시지 표시

> *Phase 5 완료 기준*: 엣지 케이스 시나리오에서 크래시 없이 정상 동작

---

## Dependencies

### Extension (root package.json devDependencies)
- `@types/vscode`: ^1.85.0
- `typescript`: ^5.x
- `esbuild`: ^0.20.x
- `asciidoctor`: ^3.x (jsonToAdoc에서 검증용)

### Webview (webview-ui/package.json)
- `react`, `react-dom`: ^18.x
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`: ^2.x
- `@tiptap/extension-underline`, `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`
- `tailwindcss`: ^3.x, `postcss`, `autoprefixer`
- `lucide-react`: latest
- `vite`: ^5.x, `@vitejs/plugin-react`: latest

## Message Protocol

```
Extension → Webview:
  { type: 'init',   content: TiptapJSONContent }   // 최초 문서 로드
  { type: 'update', content: TiptapJSONContent }   // 외부 변경 / Undo/Redo

Webview → Extension:
  { type: 'ready' }                                  // Webview 초기화 완료
  { type: 'edit',  content: TiptapJSONContent }     // 사용자 편집
```

## Undo/Redo 전략 (핵심)
1. Tiptap의 History 확장을 **비활성화**
2. 에디터 변경 시 Webview가 전체 JSON을 Extension에 전송
3. Extension이 `WorkspaceEdit`으로 문서 전체 교체 → VS Code undo stack에 등록
4. VS Code Undo 실행 → `onDidChangeTextDocument` 발생 → 이전 상태의 JSON을 Webview에 전송
5. Webview가 `editor.commands.setContent(json, false)` 로 내용 교체 (emit: false로 재전송 방지)

## Echo-Loop 방지 전략
- Extension에 `isApplyingEdit: boolean` 플래그 유지
- `applyEdit()` 호출 전 `true` 설정, 완료 후 `false`
- `onDidChangeTextDocument`에서 플래그가 `true`이면 무시

## Verification

1. **빌드 검증**: `npm run build` → `dist/extension.js` + `dist/webview/index.html` 존재 확인
2. **Extension Host 테스트**: F5 → 새 Extension Development Host → `example.sdoc` 열기 → Webview 에디터 표시 확인
3. **WYSIWYG 기능**: Bold, Italic, Underline, List, Table, CodeBlock 각각 토글 확인
4. **Toolbar 상태**: 텍스트 선택 시 활성 포맷에 해당하는 툴바 버튼 하이라이트 확인
5. **저장 파이프라인**: Ctrl+S → `.sdoc` 저장 + 동일 경로 `.adoc` 파일 자동 생성 확인
6. **AsciiDoc 정확성**: 생성된 `.adoc` 파일을 AsciiDoc 프리뷰어로 열어 렌더링 확인
7. **Undo/Redo**: 편집 → Ctrl+Z → 이전 상태 복원 + `.sdoc` 내용도 롤백 확인
8. **테마 대응**: VS Code 테마를 Light ↔ Dark 전환 시 에디터 UI가 자동 변경 확인
9. **외부 변경 감지**: 터미널에서 `.sdoc` 파일 직접 수정 → Webview에 반영 확인
10. **다중 패널**: 같은 파일을 Split Editor로 열고 한쪽 편집 → 다른 쪽 동기화 확인

## Key Risks & Mitigations
- **asciidoctor.js 번들 크기**: Extension은 Node 환경이므로 문제 없으나, 필요시 dynamic import로 lazy load
- **Undo 단위 조절**: 모든 키스트로크마다 WorkspaceEdit을 만들면 undo가 너무 세분화됨 → debounce(300ms)로 편집 배치 처리
- **대용량 JSON**: 전체 JSON 교체 방식은 대용량 문서에서 느릴 수 있음 → 초기에는 전체 교체로 시작, 필요시 diff 기반 부분 업데이트로 최적화
