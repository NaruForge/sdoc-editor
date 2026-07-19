---
ats: "0.1"
id: SDOC-051
title: "Draw.io 다이어그램 빈 이미지 생성 + 더블클릭 미실행 버그 수정"
status: done
priority: high
created: 2026-07-03T10:00:00+09:00
modified: 2026-07-03T10:00:00+09:00
author: "@copilot"
---

# SDOC-051: Draw.io 다이어그램 빈 이미지 생성 + 더블클릭 미실행 버그 수정

## Context

사용자가 tauri-app에서 Draw.io 다이어그램 삽입/편집 관련 두 가지 버그를 보고했다.

1. Draw.io 다이어그램 추가 시 빈 이미지로 삽입되며, 사용자는 "실제 파일이 폴더에 생성되지
   않는다"고 판단함. 브라우저에 표시된 URL은
   `http://asset.localhost/C%3A%2FUserData%2Fcontributor-01%2Fsdocs%2F234%2F2345%5Cdrawio%2Fdiagram-...svg`
   형태였음.
2. 에디터에서 drawio 빈 이미지를 더블클릭해도 draw.io 앱이 열리지 않음. draw.io 미설치 시
   설치 가이드/링크(https://www.drawio.com/)를 제공해야 함.

## Investigation

- Rust `create_drawio_file`/`copy_drawio_to_doc` 커맨드는 실제로 `fs::write`/`fs::copy`를
  호출해 디스크에 파일을 정상적으로 생성하고 있었음 — "파일이 생성되지 않는다"는 사용자의
  진단은 오해였고, 실제 원인은 **`asset.localhost` 커스텀 프로토콜이 전혀 활성화되어 있지
  않아 이미지 바이트가 웹뷰로 서빙되지 못해 빈 이미지처럼 보인 것**이었다.
  - `tauri.conf.json`에 `app.security.assetProtocol` 설정이 아예 없었고,
  - `Cargo.toml`의 `tauri` dependency에도 `protocol-asset` feature가 없어서, `convertFileSrc`로
    생성한 모든 `asset://`/`http://asset.localhost` URL이 원천적으로 막혀 있었음(drawio뿐
    아니라 일반 이미지도 동일하게 영향받을 수 있는 잠재적 버그였음).
- 더블클릭 미실행 원인은 `CustomImage.tsx`의 두 dblclick 핸들러가 VS Code 확장 전용 전역
  `window.vscode.postMessage(...)` 패턴을 그대로 사용하고 있었기 때문. tauri-app에는
  `window.vscode`가 존재하지 않으므로 (`createTauriAdapter()`만 사용) 조건문이 항상
  실패해 아무 동작도 하지 않았음(죽은 코드 경로).
- draw.io 미설치 시 에러 처리: `open_drawio_external` Rust 커맨드는 실패 시 `Result::Err`를
  반환하지만, 프론트엔드의 `postMessage` 호출부(`createDrawio`/`openDrawio`)에서 이 reject를
  전혀 catch하지 않아 콘솔에만 조용히 unhandled rejection으로 남고 사용자에게는 아무 안내도
  없었음.

## Scope

### In Scope
- `tauri-app/src-tauri/tauri.conf.json`: `app.security.assetProtocol.enable: true`,
  `scope: ["**"]` 추가 — 문서가 위치할 수 있는 임의의 폴더에서 이미지/drawio 자산을 서빙할 수
  있도록 허용.
- `tauri-app/src-tauri/Cargo.toml`: `tauri` dependency에 `protocol-asset` feature 추가
  (설정과 feature 플래그가 모두 있어야 `cargo build`/`tauri dev`가 통과함).
- `tauri-app/src/extensions/CustomImage.tsx`: 더블클릭 핸들러 2곳에서 `window.vscode` 우선
  대신 신규 전역 브릿지 `window.__openDrawio`를 우선 사용하도록 수정 (VS Code 웹뷰
  호환성을 위해 `window.vscode` fallback은 유지).
- `tauri-app/src/components/Editor.tsx`:
  - `handleOpenDrawio` 콜백 추가, `window.__openDrawio` 전역 브릿지로 등록/해제
    (`__editorFlushUpdate` 등 기존 패턴과 동일하게 `useEffect`에서 관리).
  - `handleDrawioNameConfirm`(다이어그램 생성) 및 `handleOpenDrawio`(더블클릭으로 열기)에서
    `postMessage(...)` 프라미스의 reject를 catch해 `DrawioInstallGuideDialog`를 표시하도록 수정.
- `tauri-app/src/components/DrawioInstallGuideDialog.tsx` (신규): draw.io 실행 실패 시
  안내 모달. `@tauri-apps/plugin-shell`의 `open()`으로 기본 브라우저에서
  `https://www.drawio.com/`을 열 수 있는 버튼 제공.

### Out of Scope
- `tiptapExtensions.ts`의 `internalLinkClick`(cross-document 링크 클릭), `LinkDialog.tsx`의
  `window.vscode` 사용 — 이번 버그와 무관한 별도 기능이므로 범위에서 제외(추후 필요 시 별도
  태스크로 진행).
- draw.io 데스크톱 앱 자동 설치 — 링크 안내까지만 지원, 설치 자동화는 범위 밖.

## Approach

- "파일이 생성 안 됨"이라는 사용자 진단을 그대로 믿지 않고 Rust 커맨드 구현을 먼저 확인해
  실제로는 파일 쓰기가 정상 동작함을 검증한 뒤, 웹뷰 표시 레이어(asset protocol)에서 문제를
  좁혀나갔다 — 표면적 증상과 근본 원인이 다를 수 있음을 보여주는 사례.
- `window.__openDrawio`는 기존에 이미 사용 중이던 `window.__editorFlushUpdate`,
  `window.__showImageContextMenu` 등과 동일한 "vanilla DOM NodeView ↔ React 통신" 브릿지
  패턴을 재사용해 일관성을 유지했다 (Rule 6.2).
- draw.io 미설치 안내는 새 다이얼로그 컴포넌트로 분리해 기존 `DrawioActionDialog`/
  `DrawioNameDialog`와 동일한 `.modal-overlay`/`.modal-content` 스타일 규약을 따르도록 했다.

## Progress
- [x] Rust `create_drawio_file`/`open_drawio_external`/`resolve_asset_path` 구현 조사
- [x] `tauri.conf.json`에 `assetProtocol.enable`/`scope` 추가
- [x] `Cargo.toml`에 `protocol-asset` feature 추가
- [x] `CustomImage.tsx` 더블클릭 핸들러를 `window.__openDrawio` 우선 사용으로 수정
- [x] `Editor.tsx`에 `window.__openDrawio` 브릿지 등록 및 draw.io 실행 실패 시 안내 다이얼로그 연결
- [x] `DrawioInstallGuideDialog.tsx` 신규 구현 (drawio.com 링크 포함)
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- `cargo check`가 `assetProtocol` 설정과 `protocol-asset` feature 중 하나만 있을 때 명확한
  에러 메시지(`The tauri dependency features on the Cargo.toml file does not match the
  allowlist defined under tauri.conf.json`)를 내어 두 변경이 반드시 짝을 이뤄야 함을 바로
  확인할 수 있었다.
- `assetProtocol.scope: ["**"]`는 문서가 임의의 사용자 폴더에 위치할 수 있는 이 앱의 특성상
  광범위하게 설정했다. 향후 보안 강화가 필요하면 워크스페이스 루트 기준으로 스코프를 좁히는
  것을 고려할 수 있다.
