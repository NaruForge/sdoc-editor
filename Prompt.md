[Role & Context]
너는 VS Code Extension 개발 및 React 프론트엔드 아키텍처 전문가야.
우리는 팀원들이 문서를 데이터 구조(JSON)로 관리하면서도 WYSIWYG 환경에서 편리하게 작성할 수 있는 'Structured Doc Editor' 익스텐션을 개발하려고 해.

[Tech Stack]
* Extension: VS Code Extension API (CustomTextEditorProvider 활용)
* Webview UI: React 18, Vite, Tailwind CSS, Lucide React (Icons)
* Editor Engine: Tiptap (ProseMirror 기반 Headless Editor)
* Data Format: Pretty-printed JSON (Git Diff 최적화)
* Conversion: Asciidoctor.js (JSON to AsciiDoc 변환)

[Core Requirements]
* Custom Editor 구현:
   * .sdoc 확장자를 가진 파일을 열면 텍스트 에디터 대신 React 기반 Webview 에디터가 실행되어야 함.
   * vscode.CustomTextEditorProvider를 사용하여 파일 시스템과 Webview 간의 실시간 양방향 동기화 구현.
* Tiptap 기반 WYSIWYG 에디터:
   * 기능: Bold, Italic, Underline, Bullet/Ordered List, Table, Code Block 지원.
   * Custom Toolbar: Tiptap의 editor.isActive() 상태를 반영하여 활성화 상태가 표시되는 세련된 툴바 UI 제작.
   * JSON 저장: 에디터의 모든 내용을 Tiptap의 정규화된 JSON 구조로 추출하여 저장.
* 데이터 저장 및 자동 변환 (Save Pipeline):
   * 사용자가 Ctrl+S로 저장 시, 원본 .sdoc (JSON) 파일을 업데이트함.
   * 핵심: 저장 직후 JSON 데이터를 파싱하여 동일한 경로에 .adoc (AsciiDoc) 파일을 자동으로 생성/업데이트하는 후처리 로직 포함.
* VS Code UX 통합:
   * VS Code의 테마 변수(--vscode-editor-background 등)를 CSS에 활용하여 다크/라이트 모드에 완벽 대응.
   * Undo/Redo 작업이 VS Code의 히스토리와 연동되도록 설정.

[Instructions for Output]
* Project Structure: 전체 폴더 및 파일 구조를 먼저 제안해줘.
* Boilerplate: package.json과 src/extension.ts의 핵심 코드를 작성해줘.
* Webview Logic: React에서 Tiptap 에디터를 초기화하고 VS Code API와 메시지를 주고받는 Editor.tsx 컴포넌트를 작성해줘.
* Converter Logic: Tiptap JSON 노드를 순회하며 단순한 AsciiDoc 문자열로 변환해주는 기본적인 jsonToAdoc.ts 유틸리티 초안을 작성해줘.
* Step-by-Step Guide: 이 익스텐션을 로컬에서 빌드하고 테스트하기 위한 명령어를 순서대로 알려줘.