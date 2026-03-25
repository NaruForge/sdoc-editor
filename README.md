# Structured Doc Editor

`.sdoc` 파일을 위한 WYSIWYG 에디터를 제공하고 자동으로 AsciiDoc으로 변환하는 VS Code 확장 프로그램입니다.

## 주요 기능

- **WYSIWYG 편집**: Tiptap 기반 리치 텍스트 에디터로 구조화된 문서를 편집
- **JSON 저장**: 문서를 pretty-printed JSON 형식으로 저장하여 Git diff 성능 최적화
- **자동 변환**: 저장 시 자동으로 `.adoc` (AsciiDoc) 파일 생성
- **VS Code 통합**: VS Code의 히스토리와 완전히 통합된 실행 취소/다시 실행 지원
- **테마 지원**: VS Code의 라이트/다크 테마에 자동 적응
- **표 편집**: 크기 조정, 컨텍스트 메뉴, 캡션/정렬/너비 설정
- **이미지 지원**: 클립보드에서 이미지 붙여넣기 및 캡션 추가
- **HTML 내보내기**: Asciidoctor를 사용한 HTML 변환 및 브라우저에서 미리보기

## 지원하는 서식

- **텍스트 서식**: 굵게, 기울임, 밑줄, 취소선, 코드
- **제목**: H1 ~ H6 (자동 번호 매기기 토글 가능)
- **목록**: 글머리 기호, 번호 매기기
- **코드 블록**: 구문 강조가 있는 코드 블록
- **표**: 표 삽입 및 편집, 캡션 및 속성 설정
- **이미지**: 클립보드 붙여넣기, 이미지 캡션

## 설치 방법

### VSIX 파일로 설치 (권장)

1. VS Code를 엽니다
2. `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)를 눌러 명령 팔레트를 엽니다
3. "Extensions: Install from VSIX..."를 입력하고 선택합니다
4. 프로젝트 루트의 `structured-doc-editor-0.1.0.vsix` 파일을 선택합니다
5. 설치 완료 후 VS Code를 다시 시작합니다

### 소스에서 빌드 (개발자용)

1. 이 저장소를 클론합니다
2. 의존성을 설치합니다:
   ```bash
   npm install
   ```
3. 확장 프로그램을 빌드합니다:
   ```bash
   npm run build
   ```
4. F5를 눌러 Extension Development Host를 실행합니다

## 사용 방법

1. `.sdoc` 확장자로 새 파일을 생성합니다
2. 커스텀 에디터가 자동으로 열립니다
3. 툴바를 사용하여 문서를 서식 지정합니다
4. Ctrl+S (Mac: Cmd+S)를 눌러 저장합니다
5. 같은 디렉토리에 `.adoc` 파일이 자동으로 생성됩니다
6. 이미지를 붙여넣으려면 클립보드의 이미지를 에디터에 붙여넣기 합니다
7. HTML로 내보내려면 `Ctrl+Shift+P`를 누르고 "Export to HTML"을 실행합니다

## 개발

### 프로젝트 구조

- `src/` - 확장 프로그램 소스 코드 (Node.js)
  - `extension.ts` - 확장 프로그램 진입점
  - `SdocEditorProvider.ts` - 커스텀 에디터 구현
  - `converter/` - JSON에서 AsciiDoc으로의 변환기
  - `commands/` - VS Code 명령 처리
- `webview-ui/` - React 기반 webview UI
  - `src/components/` - React 컴포넌트
  - `src/hooks/` - 커스텀 React 훅
  - `src/extensions/` - Tiptap 확장 설정

### 빌드 명령

- `npm run build` - 확장 프로그램과 webview 모두 빌드
- `npm run build:ext` - 확장 프로그램만 빌드
- `npm run build:webview` - Webview만 빌드
- `npm run watch` - 확장 프로그램과 webview 모두 watch 모드

### 기술 스택

- **확장 프로그램**: TypeScript, VS Code Extension API
- **Webview**: React 18, TypeScript, Vite
- **에디터**: Tiptap (ProseMirror 기반)
- **스타일링**: Tailwind CSS
- **아이콘**: Lucide React
- **변환**: 커스텀 JSON → AsciiDoc 변환기, Asciidoctor (AsciiDoc → HTML)

## 라이선스

MIT
