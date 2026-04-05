# Issue 2: main branch로 병합
- Status: Resolved
- Description:
   1. Main branch로 병합이 필요함.
   2. 그러나, Main에서 여러가지 변경이 이루어진 듯 함. 특히, tiptap이 v2에서 v3으로 격변된 듯
   3. 모든 기능을 유지하며 main에 잘 병합할 수 있는지 검토 후 병합이 필요함
- Resolution: main으로 병합 완료 (bdb3b72). 충돌은 package.json/package-lock.json만 발생, 양쪽 의존성 모두 포함하여 해결. feature/tauri-desktop, feature/tiptap-v3-upgrade 원격/로컬 모두 삭제.
- Comment
    1. copilot: 분석 결과 아래와 같음. 병합 진행.

---

## 병합 분석

### 브랜치 현황
- `main` (origin): Tiptap v3 업그레이드 + 신규 기능 (Strike, TextAlign, Color, Highlight, Subscript/Superscript, Mermaid, TOC) — 10개 커밋 선행
- `feature/tauri-desktop`: Tauri 앱 + MCP 서버 — 이전에 main에 merge된 상태, 이후 MCP 커밋 1개 추가
- `feature/tiptap-v3-upgrade` (origin only): main에 이미 merged. 삭제 대상.

### 충돌 파일 (2개만)
- `package.json` — 양쪽 devDependencies 변경 (main: tiptap v3 패키지, feature: MCP SDK + zod)
- `package-lock.json` — 자동 해결 가능 (npm install 재실행)

### 전략: main에 feature 병합
1. main checkout → feature/tauri-desktop merge
2. package.json 충돌: 양쪽 의존성 모두 포함하여 해결
3. package-lock.json: npm install로 재생성
4. 빌드 검증
5. 불필요 브랜치 삭제 (feature/tauri-desktop, feature/tiptap-v3-upgrade)