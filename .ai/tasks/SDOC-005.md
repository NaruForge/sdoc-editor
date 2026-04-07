---
ats: "0.1"
id: SDOC-005
title: "PDF 내보내기 (시스템 브라우저 headless)"
status: done
priority: high
created: 2026-04-07T09:00:00+09:00
modified: 2026-04-07T09:00:00+09:00
author: "@contributor-01"
---

# SDOC-005: PDF 내보내기 (시스템 브라우저 headless)

## Context
문서를 PDF로 내보내는 기능이 필요하다. VSIX 패키지 크기 제약상 Chromium을 번들할 수 없으므로,
시스템에 설치된 Chrome/Edge의 headless 모드(`--headless --print-to-pdf`)를 활용한다.
이 방식은 VS Code의 Markdown PDF 등 유명 확장이 사용하는 검증된 패턴이다.

## Scope
### In Scope
- 시스템 Chrome/Edge/Chromium 자동 탐지 (platform별 경로)
- HTML self-contained 생성 (SDOC-004) → headless 브라우저 `--print-to-pdf` 변환
- `structuredDocEditor.exportToPdf` 커맨드 등록
- `@media print` CSS 최적화 (페이지 나누기, 머리글/바닥글)
- 에러 핸들링: 브라우저 미감지 시 안내 메시지

### Out of Scope
- 커스텀 머리글/바닥글 템플릿 (추후)
- Puppeteer/Playwright 번들링
- Tauri 앱 PDF 내보내기 (별도 경로)

## Approach
1. SDOC-004 (HTML self-contained) 완료 후 진행 — PDF의 입력이 self-contained HTML
2. 브라우저 탐지 유틸리티: Windows(Edge/Chrome 레지스트리+기본경로), macOS, Linux 순서로 탐색
3. `child_process.execFile`로 headless 브라우저 실행:
   ```
   chrome --headless --disable-gpu --print-to-pdf=output.pdf --no-margins input.html
   ```
4. PDF 설정 옵션: 용지 크기, 여백, 머리글/바닥글 on/off
5. package.json에 커맨드 + 설정 등록

## Progress
- [x] 브라우저 탐지 유틸리티 구현 (src/utils/browserDetect.ts)
- [x] exportToPdf 커맨드 구현 (src/commands/exportToPdf.ts)
- [x] @media print CSS 추가 (기존 converter에 이미 포함)
- [x] package.json 커맨드 등록
- [ ] 테스트
