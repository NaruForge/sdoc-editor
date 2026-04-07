---
ats: "0.1"
id: SDOC-006
title: "Toolbar Export 메뉴에 HTML(Self-Contained) / PDF 내보내기 연동"
status: done
priority: high
created: 2026-04-07T10:00:00+09:00
modified: 2026-04-07T10:00:00+09:00
author: "@contributor-01"
---

# SDOC-006: Toolbar Export 메뉴에 HTML(Self-Contained) / PDF 내보내기 연동

## Context
SDOC-004(HTML self-contained)와 SDOC-005(PDF export)가 커맨드 팔레트에서는 동작하지만,
사용자가 실제로 사용하는 Toolbar의 Export 드롭다운 메뉴에는 아직 반영되지 않았다.
Toolbar의 기존 HTML 내보내기를 새로운 self-contained HTML로 변경하고, PDF 옵션을 추가해야 한다.

## Scope
### In Scope
- webview-ui/src/components/Toolbar.tsx — Export 메뉴에 PDF 항목 추가
- tauri-app/src/components/Toolbar.tsx — 동일 변경
- ToolbarProps의 onExport 타입에 'pdf' 포맷 추가
- webview-ui/src/components/Editor.tsx — handleExport에 'pdf' 추가
- tauri-app/src/components/Editor.tsx — handleExport에 'pdf' 추가
- SdocEditorProvider.exportDocument() — 'pdf' 포맷 처리 + HTML에 selfContained 적용

### Out of Scope
- Tauri 앱의 PDF 내보내기 구현 (Tauri 환경에서는 headless 브라우저 방식이 다름)

## Approach
1. ToolbarProps의 onExport 타입: `'html' | 'adoc' | 'markdown'` → `'html' | 'adoc' | 'markdown' | 'pdf'`
2. Toolbar Export 메뉴에 PDF 버튼 추가 (HTML 아래)
3. Editor.tsx의 handleExport에서 'pdf' 메시지도 전달
4. SdocEditorProvider.exportDocument()에서:
   - HTML: selfContained 설정 반영 + 이미지 base64 임베딩
   - PDF: self-contained HTML 생성 후 headless 브라우저로 PDF 변환

## Progress
- [x] Toolbar 타입 + 메뉴 업데이트 (webview-ui)
- [x] Toolbar 타입 + 메뉴 업데이트 (tauri-app)
- [x] Editor.tsx handleExport 업데이트 (webview-ui)
- [x] Editor.tsx handleExport 업데이트 (tauri-app)
- [x] SdocEditorProvider.exportDocument 업데이트
- [x] 커밋/푸시
