---
ats: "0.1"
id: SDOC-040
title: "Tauri 빌드 안정화 및 문서화 (Rust 툴체인 고정)"
status: done
created: 2026-04-27
modified: 2026-04-28
author: "@copilot"
---

## Context

Windows 환경에서 `npx tauri build` 수행 시 Rust 컴파일 단계에서 `STATUS_STACK_BUFFER_OVERRUN (0xc0000409)`가 간헐적으로 발생했다.
동시에 빌드 로그에 다량의 경고가 출력되어 실패 원인 판단이 어려운 상태였다.

## Scope

### In Scope
- Tauri 빌드 실패 재현 및 원인 분류
- Rust 툴체인 버전 고정 정책 반영 (`rust-toolchain.toml`, `rust 1.90.0`)
- 빌드 스크립트 안정화 (`CARGO_BUILD_JOBS=1`)
- Cargo workspace resolver `"2"` 명시 (`tauri-app/Cargo.toml`)
- 개발 문서(`CONTRIBUTING.md`, `SETUP.md`)에 문제해결 사례 반영
- 실제 빌드 성공 및 산출물 확인 (Exit 0, exe/msi/nsis)

### Out of Scope
- Rust 경고(미사용 import/변수) 코드 정리
- 프런트엔드 chunk size 최적화
- Tauri 기능 변경

## Approach

- Rust 툴체인을 `1.90.0`으로 고정하여 1.92 계열에서 발생한 비정상 종료 리스크를 회피
- 병렬 컴파일을 `CARGO_BUILD_JOBS=1`로 제한해 환경 의존적 빌드 실패를 완화
- 실패로 오인되는 경고(Vite dynamic import, chunk warning)와 실제 실패 신호를 문서에서 분리 안내

## Progress

- [x] Tauri 전체 빌드 성공(Exit Code 0) 확인
- [x] Rust 툴체인 고정 파일 추가 (`tauri-app/rust-toolchain.toml`)
- [x] Windows 빌드 스크립트 안정화 (`build-tauri-app.ps1`)
- [x] CONTRIBUTING 문제해결 섹션 강화
- [x] SETUP 가이드에 Tauri 빌드 안정화 절차 추가
- [x] STATUS.md 업데이트
- [x] decisions.md 업데이트
