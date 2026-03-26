# Structured Doc Editor

`.sdoc` 파일을 위한 WYSIWYG 에디터를 제공하고 Markdown/AsciiDoc/HTML로 내보낼 수 있는 VS Code 확장 프로그램입니다.

## 주요 기능

- **WYSIWYG 편집**: Tiptap 기반 리치 텍스트 에디터로 구조화된 문서를 편집
- **JSON 저장**: 문서를 pretty-printed JSON 형식으로 저장하여 Git diff 성능 최적화
- **다양한 내보내기 형식**:
  - **Markdown**: GitHub/GitLab 호환 Markdown 생성
  - **AsciiDoc**: 기술 문서 작성용 AsciiDoc 형식
  - **HTML**: 테마가 적용된 독립형 HTML 문서 (LG 브랜드 컬러 기본 적용)
- **Markdown/HTML 가져오기**: 기존 Markdown 또는 HTML 문서를 `.sdoc`로 변환
- **Draw.io 다이어그램 통합**:
  - 툴바에서 Draw.io 다이어그램 삽입
  - 다이어그램 더블클릭으로 편집 (VS Code Draw.io Integration 필요)
  - SVG 형식으로 저장되어 버전 관리 친화적
- **수학 수식**: KaTeX 기반 인라인/블록 수식 지원
- **교차 참조**: `@` 입력으로 heading, figure, table 참조 삽입 및 자동 번호 동기화
- **섹션 접기**: heading 옆 토글로 섹션별 접기/펼치기
- **문서 메타데이터**: Title, Author, Version을 DocumentHeader에서 직접 편집
- **자동 업데이트**: 공유 폴더 기반 사내 자동 업데이트 지원
- **테마 커스터마이징**: 회사 로고, 색상, 폰트 등을 VS Code 설정에서 쉽게 변경
- **VS Code 통합**: VS Code의 히스토리와 완전히 통합된 실행 취소/다시 실행 지원
- **테마 지원**: VS Code의 라이트/다크 테마에 자동 적응
- **표 편집**: 크기 조정, 컨텍스트 메뉴, 캡션/정렬/너비 설정
- **이미지 지원**: 클립보드에서 이미지 붙여넣기 및 캡션 추가

## 지원하는 서식

- **텍스트 서식**: 굵게, 기울임, 밑줄, 취소선, 코드
- **제목**: H1 ~ H3 (자동 번호 매기기 토글 가능)
- **목록**: 글머리 기호, 번호 매기기
- **코드 블록**: 구문 강조가 있는 코드 블록
- **표**: 표 삽입 및 편집, 캡션 및 속성 설정
- **이미지**: 클립보드 붙여넣기, 이미지 캡션
- **수학 수식**: KaTeX 인라인/블록 수식
- **교차 참조**: heading, figure, table 간 참조 링크
- **Draw.io 다이어그램**: 벡터 다이어그램 삽입 및 편집

## 필수 권장 확장 프로그램

**Draw.io 다이어그램 편집 기능을 사용하려면:**
- [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) 확장 프로그램 설치
- 설치 후 `.drawio.svg` 파일을 더블클릭하면 Draw.io 편집기가 열립니다

## 설치 방법

### VSIX 파일로 설치 (권장)

1. VS Code를 엽니다
2. `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)를 눌러 명령 팔레트를 엽니다
3. "Extensions: Install from VSIX..."를 입력하고 선택합니다
4. `.vsix` 파일을 선택합니다
5. 설치 완료 후 VS Code를 다시 시작합니다

> **사내 사용자**: 공유 폴더에서 자동 업데이트를 받으려면 설정에서 `structuredDocEditor.update.sharedFolder` 경로를 확인하세요.

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
5. **이미지 붙여넣기**: 클립보드의 이미지를 에디터에 붙여넣기
6. **Draw.io 다이어그램 삽입**: 툴바의 "Draw.io" 버튼 클릭 → 파일명 입력
7. **Draw.io 다이어그램 편집**: 다이어그램을 더블클릭 (점선 테두리로 표시됨)
8. **내보내기**:
   - Markdown: `Ctrl+Shift+P` → "Structured Doc: Export to Markdown"
   - AsciiDoc: `Ctrl+Shift+P` → "Structured Doc: Export to AsciiDoc"
   - HTML: `Ctrl+Shift+P` → "Structured Doc: Export to HTML"

## 테마 커스터마이징

HTML 내보내기 시 회사 브랜딩을 적용하려면 VS Code 설정을 편집하세요:

1. `Ctrl+,` (Mac: `Cmd+,`)로 설정 열기
2. "Structured Doc Editor" 검색
3. 다음 항목 설정:
   - **Company Logo**: 로고 이미지 URL 또는 base64 인코딩된 이미지
   - **Company Name**: 회사명 (기본: LG Magna e-Powertrain)
   - **Primary Color**: 제목 및 테이블 헤더 색상 (기본: #A50034 — LG RED)
   - **Accent Color**: 부제목 색상 (기본: #6b6b6b — LG GRAY)
   - **Font Family**: 글꼴 (기본: 시스템 기본 글꼴)
   - **Custom Styles**: 추가 CSS (고급 사용자용)

또는 `.vscode/settings.json`에 직접 추가:
```json
{
  "structuredDocEditor.theme.companyName": "LG Magna e-Powertrain",
  "structuredDocEditor.theme.companyLogo": "legacy-brand-logo.png",
  "structuredDocEditor.theme.primaryColor": "#A50034",
  "structuredDocEditor.theme.accentColor": "#6b6b6b"
}
```

## 개발

### 프로젝트 구조

- `src/` - 확장 프로그램 소스 코드 (Node.js)
  - `extension.ts` - 확장 프로그램 진입점
  - `SdocEditorProvider.ts` - 커스텀 에디터 구현
  - `converter/` - JSON → Markdown/AsciiDoc/HTML 변환기, Markdown → JSON 변환기
  - `commands/` - VS Code 명령 처리 (내보내기 등)
  - `updateChecker.ts` - 공유 폴더 기반 자동 업데이트
- `webview-ui/` - React 기반 webview UI
  - `src/components/` - React 컴포넌트
  - `src/hooks/` - 커스텀 React 훅
  - `src/extensions/` - Tiptap 확장 설정

### 빌드 명령

- `npm run build` - 확장 프로그램과 webview 모두 빌드
- `npm run build:ext` - 확장 프로그램만 빌드
- `npm run build:webview` - Webview만 빌드
- `npm run package` - 빌드 + VSIX 패키징 (`output/` 폴더에 `.vsix` + `version.json` 생성)
- `npm run watch` - 확장 프로그램과 webview 모두 watch 모드

### 기술 스택

- **확장 프로그램**: TypeScript, VS Code Extension API
- **Webview**: React 18, TypeScript, Vite
- **에디터**: Tiptap (ProseMirror 기반)
- **스타일링**: Tailwind CSS
- **아이콘**: Lucide React
- **변환**: JSON → Markdown/AsciiDoc/HTML 변환기, Markdown → JSON 변환기 (테마 지원)
- **수식**: KaTeX

## 라이선스

MIT
