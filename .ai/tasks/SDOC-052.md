---
ats: "0.1"
id: SDOC-052
title: "Draw.io 경로 파싱 근본 수정 — relativePath 속성 도입 (SDOC-051 후속)"
status: done
priority: high
created: 2026-07-02T16:12:00+09:00
modified: 2026-07-02T16:12:00+09:00
author: "@copilot"
---

# SDOC-052: Draw.io 경로 파싱 근본 수정 — relativePath 속성 도입 (SDOC-051 후속)

## Context

SDOC-051에서 `assetProtocol` 설정과 `window.__openDrawio` 브릿지를 추가한 뒤 사용자가
재테스트한 결과, 두 가지 잔존 버그가 보고되었다.

1. Draw.io를 처음 생성할 때는 Windows의 draw.io 앱과 정상 연결되어 열리지만, 삽입된
   이미지를 다시 더블클릭하면 (실제로 draw.io가 설치되어 있음에도) "설치 안내" 팝업이
   나타남.
2. Draw.io 이미지의 "속성(Path)"에 표시되는 저장 경로가 `http://asset.localhost/...`
   형태로 노출됨. 실제 문서 디렉토리 기준 상대 경로(`./drawio/...`)여야 함.

## Investigation

- 두 버그 모두 동일한 근본 원인: **Windows 절대 경로는 백슬래시(`\`) 구분자를 쓰고,
  `convertFileSrc`가 이를 퍼센트 인코딩하면 `%5C`가 되는데, 기존 코드는 리터럴 슬래시(`/`)만
  찾는 정규식(`/drawio\/([^?#]+)/`, `/(?:images|drawio)\/([^?#]+)/`)으로 asset URL에서 상대
  경로를 역추출하고 있었다.**
  - 예: 문서 경로 `.../2345`, drawio 파일 `drawio/diagram-x.drawio.svg` → Rust가
    `doc_dir.join("drawio/diagram-x.drawio.svg")`로 만든 절대 경로는 Windows에서
    `...\2345\drawio\diagram-x.drawio.svg`가 되고, `convertFileSrc`로 인코딩하면
    `...%5Cdrawio%5Cdiagram-x.drawio.svg`가 됨 — 리터럴 `/`가 아니라 `%5C`이므로 기존
    정규식이 전혀 매치되지 않음.
  - 더블클릭 시: 정규식 매치 실패 → `drawioPath`가 전체 asset URL로 남음 →
    `resolve_asset_path`가 이 URL 문자열을 그대로 `doc_dir.join(...)`에 붙여 존재하지
    않는 엉뚱한 경로를 생성 → `open_drawio_external`이 "파일을 찾을 수 없음"으로 실패 →
    (draw.io가 정상 설치되어 있어도) 설치 안내 다이얼로그가 뜸.
  - 속성 다이얼로그/경로 복사 시: 동일한 정규식 실패로 `getPath()`/`handleImageContextMenuCopyPath`가
    폴백으로 원본 asset URL을 그대로 반환.
- `isDrawio` 판별(`.drawio.svg` 포함 여부)은 확장자 문자열이 인코딩 대상이 아니므로 broken이
  아니었음 — 문제는 오직 "상대 경로 역추출" 로직에 국한됨.

## Scope

### In Scope
- `tauri-app/src/extensions/CustomImage.tsx`:
  - `CustomImage` 노드에 `relativePath` 속성 추가 (`data-relative-path`로 직렬화). 이미지/
    drawio 생성 시 백엔드가 반환한 정확한 상대 경로를 노드에 영구 저장해, 이후 어떤 코드도
    asset URL을 역파싱할 필요가 없도록 함.
  - `extractRelativePathFromSrc(src)` 레거시 문서(속성 도입 이전에 만들어진 문서)를 위한
    폴백 함수 추가 — `decodeURIComponent`로 먼저 디코딩한 뒤 `[\\/]` 문자 클래스로 슬래시와
    백슬래시를 모두 매치하도록 수정(근본 버그 수정).
  - 더블클릭 핸들러 2곳, `refreshImage()`의 title 툴팁 모두 `relativePath` 속성 우선 →
    `extractRelativePathFromSrc` 폴백 순으로 사용하도록 변경.
- `tauri-app/src/components/Editor.tsx`:
  - `imageSaved`/`drawioCreated`/`imageInserted`/`imageReplaced` 메시지 핸들러에서
    `setImage`/`setNodeMarkup` 호출 시 백엔드가 이미 반환하던 `imagePath`/`drawioPath`를
    `relativePath` 속성으로 함께 저장.
  - `handleImageContextMenuProperties`/`handleImageContextMenuCopyPath`가 노드의
    `relativePath` 속성(→ 폴백으로 `extractRelativePathFromSrc`)을 사용하도록 수정.
  - `imageProperties` 상태에 `path?: string` 필드 추가, `ImagePropertiesDialog`에 전달.
- `tauri-app/src/components/ImagePropertiesDialog.tsx`: 신규 `path` prop을 받아 있으면
  그대로 표시하고, 없을 때만 기존 정규식 기반 추출로 폴백.

### Out of Scope
- 레거시 문서 마이그레이션 스크립트 — 문서를 다시 열고 이미지를 한 번이라도 교체/재생성하면
  자동으로 `relativePath`가 채워지므로 별도 마이그레이션 불필요.

## Approach

- 근본 원인이 "매번 다른 곳에서 URL을 파싱해 경로를 추측하는" 구조적 문제였으므로, 파싱을
  수정하는 대신 **생성 시점에 알고 있는 정확한 상대 경로를 노드 속성으로 영구 저장**하는
  방식으로 전환했다 — Rule 1.1(복제 금지)에 따라 "asset URL → 상대 경로" 역산 로직이 여러
  파일(더블클릭 핸들러 2곳, properties 다이얼로그, copy-path, title 툴팁)에 중복돼 있던 것을
  근본적으로 없앤 것.
- 레거시 호환을 위한 `extractRelativePathFromSrc`도 인코딩 버그 자체를 고쳐, 속성이 없는
  구 버전 문서에서도 최소한 더블클릭/경로 복사가 동작하도록 안전망을 마련했다.

## Progress
- [x] 근본 원인 규명 (Windows 백슬래시 → `%5C` 인코딩과 `/`-only 정규식 불일치)
- [x] `CustomImage.tsx`에 `relativePath` 노드 속성 추가
- [x] `extractRelativePathFromSrc` 폴백 함수 구현 (디코딩 후 `[\\/]` 매치)
- [x] 더블클릭 핸들러 2곳, `refreshImage()` title 툴팁 수정
- [x] `Editor.tsx`의 이미지 삽입/교체 4개 케이스에 `relativePath` 저장 추가
- [x] `handleImageContextMenuProperties`/`handleImageContextMenuCopyPath` 수정
- [x] `ImagePropertiesDialog`에 `path` prop 추가
- [x] `tsc --noEmit`, `cargo check` 통과 확인

## Notes
- 이 수정으로 "속성 저장 시점부터" 생성된 이미지/drawio는 asset URL 인코딩 방식과 무관하게
  항상 정확한 상대 경로를 유지한다. 향후 이미지 저장 관련 새 기능(예: 이미지 목록 패널)을
  추가할 때도 `node.attrs.relativePath`를 우선 사용해야 한다.
