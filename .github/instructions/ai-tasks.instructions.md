---
applyTo: "**"
---

# AI Task Standard (ATS) — Agent Instructions

이 프로젝트는 **AI Task Standard (ATS) v0.1**을 사용하여 태스크를 관리합니다.

## 작업 시작 시

1. `.ai/STATUS.md`를 읽어 프로젝트 현재 상태를 파악하세요.
2. 현재 작업과 관련된 태스크가 `.ai/tasks/`에 있으면 해당 파일의 **Context**, **Approach**, **Progress** 섹션을 참조하세요.
3. `.ai/decisions.md`에서 관련 결정 이력을 확인하세요. 이전 세션에서 내린 결정을 번복하지 마세요.

## 작업 중

- 주요 설계 결정을 내렸으면 `.ai/decisions.md`에 기록하세요 (Date, Task, Agent/Author, Decision, Rationale).
- 태스크의 **Progress** 섹션을 업데이트하세요 (완료된 항목 체크).

## 작업 완료 시

1. 태스크 파일의 frontmatter `status`와 `modified`를 업데이트하세요.
2. `.ai/STATUS.md`를 현재 상태에 맞게 업데이트하세요.
3. 태스크의 **Progress** 섹션에서 완료 항목을 체크하세요.

## 새 태스크 생성 시

사용자가 "태스크 만들어줘"라고 요청하면:

1. `.ai/config.yaml`에서 프로젝트 접두사를 확인하세요.
2. `.ai/tasks/`의 기존 파일에서 가장 높은 번호를 찾아 다음 번호를 부여하세요.
3. `.ai/tasks/{PREFIX}-{NNN}.md` 형식으로 생성하세요.
4. YAML frontmatter에 최소한 `ats`, `id`, `title`, `status`, `created`, `modified`, `author` 필드를 포함하세요.
5. 사용자가 설명한 내용으로 **Context**와 **Scope** 섹션을 작성하세요.
6. `.ai/STATUS.md`에 새 태스크를 추가하세요.
