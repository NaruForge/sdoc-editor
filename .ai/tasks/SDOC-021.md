---
ats: "0.1"
id: SDOC-021
title: "설정 패널 UX 개선 — 텍스트 입력 디바운스 + CrossRef 동적 라벨"
status: done
priority: high
created: 2026-04-13T17:00:00+09:00
modified: 2026-04-13T17:30:00+09:00
author: "@contributor-01"
---

# SDOC-021: 설정 패널 UX 개선 — 텍스트 입력 디바운스 + CrossRef 동적 라벨

## Context

SDOC-019에서 도입한 문서별 설정 패널(Document Settings Panel)에 두 가지 UX 문제 발생:

1. **텍스트 입력 끊김**: 이미지 접두사/표 접두사 입력 시 매 키스트로크마다 `postMessage → Extension Host 파일 쓰기 → settingsChanged 수신 → 전체 리렌더` 라운드트립이 발생하여 타이핑이 끊김
2. **CrossRef 라벨 미갱신**: 접두사를 "Image"→"그림"으로 변경해도 기존 CrossRef 텍스트가 "Figure 1"에서 업데이트되지 않음. `collectTargets()`, `buildIdMap()`에서 "Figure"/"Table" 하드코딩

## Scope

### In Scope

**1. 텍스트 입력 디바운스:**
- DocumentSettingsPanel의 텍스트 입력을 로컬 state로 관리
- Enter 키 또는 blur 이벤트 시에만 `onUpdateSettings` 호출
- 토글/컬러/라디오 등 비텍스트 입력은 기존 즉시 반영 유지

**2. CrossRef 동적 라벨:**
- `collectTargets()`, `buildIdMap()`에서 하드코딩 "Figure"/"Table" → `window.__editorSettings`의 접두사 사용
- 설정 변경 시 CrossRef 텍스트 자동 동기화 (appendTransaction 트리거)
- captionNumbering(simple/hierarchical) 모드도 반영

**3. tauri-app 동기화**

### Out of Scope
- 캡션 렌더링 자체 (CSS 기반, 이미 정상 동작)
- 새로운 CrossRef 데이터 구조 (mark 스키마 변경 등)

## Approach

### 1. 텍스트 입력 디바운스
- DocumentSettingsPanel 내부에 `localPrefix` state 추가
- `onChange` → 로컬 state만 갱신 (리렌더 없음)
- `onKeyDown(Enter)` 또는 `onBlur` → `updateField()` 호출하여 실제 적용
- 색상/토글/라디오는 변경 없음

### 2. CrossRef 동적 라벨
- `collectTargets()`: `window.__editorSettings?.imageCaptionPrefix` 사용
- `buildIdMap()`: 동일하게 prefix 동적 읽기
- Settings 변경 시 CrossRef 재동기화를 위해 빈 transaction 트리거

## Progress
- [x] DocumentSettingsPanel 텍스트 입력 디바운스 (webview-ui)
- [x] CrossRef collectTargets/buildIdMap prefix 동적화 (webview-ui)
- [x] Settings 변경 시 CrossRef 재동기화 트리거
- [x] tauri-app 동기화
- [x] 테스트 및 검증
