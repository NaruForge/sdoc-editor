# 설치 및 테스트 가이드

## 사전 요구사항

- Node.js 18+ 및 npm
- VS Code 1.85.0 이상

## 설치 방법

### 방법 1: VSIX 파일로 설치 (권장)

`.vsix` 파일을 사용하여 설치:

1. VS Code를 엽니다
2. `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)를 눌러 명령 팔레트를 엽니다
3. "Extensions: Install from VSIX..."를 입력하고 선택합니다
4. `.vsix` 파일을 선택합니다
5. 설치 완료 후 VS Code를 다시 시작합니다

> **사내 사용자**: `structuredDocEditor.update.sharedFolder` 설정으로 공유 폴더 자동 업데이트를 받을 수 있습니다.

**VSIX 파일 재생성이 필요한 경우:**
```bash
npx @vscode/vsce package --allow-missing-repository --no-dependencies
```

### 방법 2: 개발 모드로 실행 (개발자용)

1. **의존성 설치**
   ```bash
   npm install
   ```

2. **확장 프로그램 빌드**
   ```bash
   npm run build
   ```

3. **Extension Development Host 실행**
   - VS Code에서 프로젝트를 엽니다
   - `F5`를 눌러 Extension Development Host를 실행합니다
   - 새 VS Code 창이 열리면서 확장 프로그램이 로드됩니다

## 확장 프로그램 사용 방법

1. `.sdoc` 확장자를 가진 파일을 엽니다 (예: `sample/example.sdoc`)
2. 자동으로 커스텀 에디터가 실행됩니다
3. WYSIWYG 방식으로 문서를 편집합니다
4. `Ctrl+S` (Mac: `Cmd+S`)로 저장합니다
5. **내보내기**:
   - Markdown: `Ctrl+Shift+P` → "Structured Doc: Export to Markdown"
   - AsciiDoc: `Ctrl+Shift+P` → "Structured Doc: Export to AsciiDoc"
   - HTML: `Ctrl+Shift+P` → "Structured Doc: Export to HTML"

## 개발 워크플로우

### Watch 모드

개발 중 파일 변경 시 자동으로 재빌드하려면:

```bash
npm run watch
```

다음 두 가지가 동시에 실행됩니다:
- `watch:ext` - 확장 프로그램 TypeScript 파일 감시
- `watch:webview` - Webview React 파일 감시

### 개별 빌드

- 확장 프로그램만: `npm run build:ext`
- Webview만: `npm run build:webview`

## 에디터 기능 테스트

1. **새 .sdoc 파일 생성**
   - `test.sdoc` 파일을 생성합니다
   - 에디터가 자동으로 열립니다

2. **서식 옵션 테스트**
   - 툴바 버튼 클릭: 굵게, 기울임, 밑줄
   - 제목 레벨: H1, H2, H3
   - 목록: 글머리 기호, 번호 매기기
   - 표 삽입
   - 코드 블록 추가
   - 이미지 붙여넣기 (클립보드에서)

3. **저장 및 변환 테스트**
   - `Ctrl+S` (Mac: `Cmd+S`)로 저장
   - `Ctrl+Shift+P` → "Structured Doc: Export to AsciiDoc" 실행
   - 같은 디렉토리에 `test.adoc` 파일이 생성되었는지 확인
   - `.adoc` 파일을 열어 AsciiDoc 출력 확인
   - `Ctrl+Shift+P` → "Structured Doc: Export to HTML" 실행
   - 생성된 HTML 파일 확인

4. **실행 취소/다시 실행 테스트**
   - 편집 작업 수행
   - `Ctrl+Z`로 실행 취소
   - `Ctrl+Shift+Z`로 다시 실행
   - `.sdoc` JSON이 올바르게 업데이트되는지 확인

5. **테마 통합 테스트**
   - VS Code 테마 변경 (파일 > 기본 설정 > 색 테마)
   - 에디터가 라이트/다크 테마에 맞춰 변경되는지 확인

6. **HTML 내보내기 테스트**
   - `Ctrl+Shift+P`로 명령 팔레트 열기
   - "Structured Doc: Export to HTML" 입력 및 실행
   - 생성된 HTML 파일이 브라우저에서 열리는지 확인
   - 회사 로고/테마 설정 테스트 (설정에서 변경 후 재시도)

## 테마 설정

HTML 내보내기 시 회사 브랜딩을 적용하려면:

1. `Ctrl+,`로 VS Code 설정 열기
2. "Structured Doc Editor" 검색
3. 테마 관련 설정 변경:
   - Company Logo
   - Company Name
   - Primary Color
   - Accent Color
   - Font Family
   - Custom Styles

## 검증 체크리스트

- [ ] 확장 프로그램이 오류 없이 빌드됨
- [ ] Webview가 오류 없이 빌드됨
- [ ] `.sdoc` 파일이 커스텀 에디터에서 열림
- [ ] 툴바 버튼이 작동하고 활성 상태 표시됨
- [ ] Ctrl+S로 문서가 저장됨
- [ ] Markdown 내보내기 명령이 작동함
- [ ] AsciiDoc 내보내기 명령이 작동함
- [ ] HTML 내보내기 명령이 작동함
- [ ] 테마 설정이 HTML 출력에 반영됨
- [ ] 실행 취소/다시 실행이 올바르게 작동함
- [ ] 에디터가 VS Code 테마 변경에 적응함
- [ ] `.sdoc` 파일의 외부 변경이 에디터에 반영됨
- [ ] 표 캡션 및 속성이 올바르게 저장됨
- [ ] 이미지 붙여넣기가 작동함

## 문제 해결

### 확장 프로그램이 활성화되지 않음
- 출력 패널 확인 (보기 > 출력) 및 "Structured Doc Editor" 선택
- package.json의 activationEvents 확인
- 재빌드: `npm run build`
- VS Code 재시작

### Webview가 로드되지 않음
- Webview의 브라우저 콘솔 확인 (도움말 > 개발자 도구 전환)
- dist/webview/에 index.html, index.js, index.css가 있는지 확인
- Webview 재빌드: `npm run build:webview`

### 변경사항이 반영되지 않음
- Watch 모드 사용 시 두 watcher가 모두 실행 중인지 확인
- Extension Development Host를 중지하고 다시 시작
- VS Code 캐시 삭제: 모든 창 닫기, 작업 공간 저장소 삭제

### .adoc 파일이 생성되지 않음
- 자동 생성은 제거되었습니다
- `Ctrl+Shift+P` → "Structured Doc: Export to AsciiDoc" 명령을 사용하세요
- .sdoc 파일에 유효한 JSON이 포함되어 있는지 확인
- VS Code 알림에서 오류 메시지 확인
- `src/converter/jsonToAdoc.ts`의 변환 로직 확인

## 프로젝트 구조

```
.
├── .vscode/
│   ├── launch.json         # F5 디버그 설정
│   └── tasks.json          # 빌드 작업
├── dist/                   # 컴파일된 출력 (git 무시)
│   ├── extension.js        # 확장 프로그램 번들
│   └── webview/            # Webview 번들
├── src/                    # 확장 프로그램 소스
│   ├── extension.ts        # 진입점
│   ├── SdocEditorProvider.ts
│   ├── commands/
│   │   ├── exportToHtml.ts
│   │   ├── exportToAdoc.ts
│   │   └── exportToMarkdown.ts
│   ├── converter/
│   │   ├── jsonToAdoc.ts
│   │   ├── jsonToHtml.ts
│   │   ├── jsonToMarkdown.ts
│   │   └── markdownToJson.ts
│   ├── updateChecker.ts
│   └── utils/
│       └── webviewHelper.ts
├── webview-ui/             # React webview
│   ├── src/
│   │   ├── components/     # UI 컴포넌트
│   │   ├── context/        # React 컨텍스트
│   │   ├── extensions/     # Tiptap 확장
│   │   ├── hooks/          # React 훅
│   │   └── styles/         # CSS 스타일
│   ├── package.json
│   └── vite.config.ts
├── sample/
│   ├── example.sdoc        # 샘플 문서
│   └── images/             # 샘플 이미지
└── package.json            # 확장 프로그램 매니페스트
```

## 주요 기능

### 편집 기능
- **텍스트 서식**: 굵게, 기울임, 밑줄, 취소선, 코드
- **제목**: H1 ~ H3 (자동 번호 매기기 토글 가능)
- **목록**: 글머리 기호, 번호 매기기
- **표**: 크기 선택, 컨텍스트 메뉴, 캡션/정렬/너비 설정
- **코드 블록**: 언어별 구문 강조
- **이미지**: 클립보드 붙여넣기, 캡션 지원
- **수학 수식**: KaTeX 인라인/블록 수식
- **교차 참조**: `@` 입력으로 heading, figure, table 참조 삽입
- **섹션 접기**: heading 옆 토글로 섹션별 접기/펼치기
- **문서 메타데이터**: Title, Author, Version 인라인 편집
- **실행 취소/다시 실행**: VS Code 기본 기능과 통합

### 저장 및 내보내기
- `.sdoc` (JSON) 형식으로 저장
- **Markdown 내보내기**: 명령 팔레트에서 "Export to Markdown" 실행
- **AsciiDoc 내보내기**: 명령 팔레트에서 "Export to AsciiDoc" 실행
- **HTML 내보내기**: 명령 팔레트에서 "Export to HTML" 실행
  - 테마 커스터마이징 지원 (회사 로고, 색상, 폰트 등)
  - VS Code 설정에서 테마 관리
- **Markdown/HTML 가져오기**: 툴바 Import 버튼으로 기존 문서를 `.sdoc`로 변환

### UI/UX
- VS Code 테마 자동 적응 (라이트/다크 모드)
- 툴바 및 버블 메뉴
- 표/이미지 캡션 인라인 편집


