# 실행 및 디버깅 가이드

## 🚀 빠른 시작 (3단계)

### 1️⃣ Extension 실행하기

현재 프로젝트가 VS Code에 열려있는 상태에서:

```
키보드에서 F5 누르기
```

자동으로 일어나는 일:
- ✅ Extension 빌드 (`npm run build:ext`)
- ✅ 새 VS Code 창 열림 (Extension Development Host)
- ✅ 확장 프로그램 활성화

**성공 확인 방법:**
- 새 창 상단에 `[Extension Development Host]` 표시
- 원본 창 하단에 디버그 도구바 나타남 (빨간 정지 버튼 등)

### 2️⃣ 에디터 열기

**Extension Development Host 창**에서:

1. **File > Open Folder** (Ctrl+K Ctrl+O)
2. 프로젝트의 `sample` 폴더 선택
3. `example.sdoc` 파일 클릭

**예상 결과:**
- 텍스트 에디터가 아닌 WYSIWYG 에디터 나타남
- 상단에 툴바 (Bold, Italic 등) 표시
- 샘플 내용이 보기 좋게 렌더링됨

### 3️⃣ 기능 테스트

- [ ] 텍스트 입력해보기
- [ ] 툴바 버튼 클릭 (Bold, Italic 등)
- [ ] **Ctrl+S** 눌러서 저장
- [ ] `example.adoc` 파일이 생성되는지 확인
- [ ] **Ctrl+Z** 눌러서 Undo 테스트

---

## 🔍 디버깅 방법

### Extension 코드 디버깅 (Node.js/TypeScript)

**언제:** Extension 로직 (파일 저장, 메시지 처리 등) 문제 해결 시

**방법:**

1. **중단점 설정**
   ```
   src/SdocEditorProvider.ts 열기
   → 줄 번호 왼쪽 클릭 (빨간 점 생성)
   → 예: 58번 줄 (case 'edit':)
   ```

2. **F5로 실행** → Extension Development Host에서 저장 시도

3. **중단점에서 멈추면:**
   - 왼쪽 "VARIABLES" 패널에서 변수값 확인
   - 하단 "DEBUG CONSOLE"에 명령어 입력 가능
     ```typescript
     message.content
     document.getText()
     ```

4. **계속 실행:**
   - F5: Continue
   - F10: Step Over (다음 줄)
   - F11: Step Into (함수 안으로)

**콘솔 로그 확인:**
```typescript
// src/SdocEditorProvider.ts에 추가
console.log('📝 Received message:', message.type);
```
→ 원본 VS Code 창의 DEBUG CONSOLE 탭에서 확인

---

### Webview 코드 디버깅 (React)

**언제:** UI 버튼, 에디터 동작 등 React 관련 문제 해결 시

**방법:**

1. **Developer Tools 열기**
   ```
   Extension Development Host 창에서
   Help > Toggle Developer Tools (Ctrl+Shift+I)
   ```

2. **Console 탭**
   - React 에러 확인
   - 콘솔 로그 확인
   
   ```typescript
   // webview-ui/src/components/Editor.tsx에 추가
   console.log('🎨 Editor mounted', state.doc);
   ```

3. **Elements 탭**
   - HTML 구조 확인
   - CSS 스타일 디버깅
   - `.toolbar-button.is-active` 클래스 확인

4. **Sources 탭**
   - `webpack://` → `src/` 폴더에서 React 코드 찾기
   - 중단점 설정 가능 (줄 번호 클릭)

5. **Network 탭**
   - 리소스 로딩 확인 (index.js, index.css)

---

## 🐛 자주 발생하는 문제 해결

### 문제 1: Extension이 활성화되지 않음

**증상:**
- `.sdoc` 파일을 열어도 일반 텍스트 에디터로 열림

**해결:**
1. 원본 VS Code 창에서 **Output 패널** 확인
   - View > Output (Ctrl+Shift+U)
   - 드롭다운: "Structured Doc Editor" 선택
   - 에러 메시지 확인

2. Extension 재빌드
   ```bash
   npm run build
   ```

3. Extension Development Host 재시작
   - 원본 창에서 디버그 도구바의 🔄 버튼 클릭
   - 또는 Ctrl+R (Extension Development Host 창에서)

---

### 문제 2: Webview가 빈 화면

**증상:**
- `.sdoc` 파일 열면 흰색/검은색 빈 화면

**해결:**
1. **Developer Tools 열기** (Ctrl+Shift+I)
2. **Console 탭**에서 에러 확인
   - "Failed to load resource" → Webview 빌드 확인
   - "SyntaxError" → React 코드 문법 오류

3. **Webview 재빌드**
   ```bash
   npm run build:webview
   ```

4. **파일 확인**
   ```bash
   ls -la dist/webview/assets/
   # index.js, index.css 있어야 함
   ```

---

### 문제 3: 저장은 되지만 .adoc 파일이 안 생김

**증상:**
- Ctrl+S 누르면 .sdoc 저장됨
- .adoc 파일은 생성되지 않음

**디버깅:**
1. **중단점 설정**
   ```
   src/SdocEditorProvider.ts
   → 121번 줄 (generateAdocFile 메서드)
   ```

2. **문제 확인**
   - JSON 파싱 에러?
   - 파일 쓰기 권한?

3. **콘솔 확인**
   ```typescript
   console.log('JSON:', json);
   console.log('ADOC:', adocContent);
   ```

---

### 문제 4: Undo/Redo가 이상하게 동작

**증상:**
- Ctrl+Z를 눌러도 변경사항이 안 되돌아감
- 또는 한참 전으로 돌아감

**원인:**
- Debounce 타이밍 문제 (300ms)
- `isApplyingEdit` 플래그 문제

**디버깅:**
1. 콘솔 로그 추가
   ```typescript
   // src/SdocEditorProvider.ts
   console.log('Applying edit, flag:', this.isApplyingEdit);
   ```

2. Debounce 시간 조절
   ```typescript
   // webview-ui/src/hooks/useTiptapEditor.ts
   // 300ms → 500ms로 변경
   setTimeout(() => { ... }, 500);
   ```

---

## 📊 유용한 디버깅 팁

### Tip 1: Hot Reload

**Watch 모드 사용:**
```bash
npm run watch
```

파일 수정 시 자동 재빌드:
- Extension 코드 변경 → 자동 빌드 → Extension Development Host에서 **Ctrl+R**로 새로고침
- Webview 코드 변경 → 자동 빌드 → Extension Development Host에서 **Ctrl+R**로 새로고침

### Tip 2: 양쪽 DevTools 동시에

1. **원본 창**: Extension 디버깅 (DEBUG CONSOLE)
2. **Extension Development Host 창**: Webview 디버깅 (Ctrl+Shift+I)

### Tip 3: JSON 파일 직접 확인

```bash
# .sdoc 파일 내용 확인
cat sample/example.sdoc | jq .

# 예쁘게 포맷
cat sample/example.sdoc | jq . > temp.json
```

### Tip 4: 메시지 흐름 추적

Extension ↔ Webview 메시지 확인:

**Extension:**
```typescript
// src/SdocEditorProvider.ts
console.log('📤 Sending to webview:', message.type);
console.log('📥 Received from webview:', message.type);
```

**Webview:**
```typescript
// webview-ui/src/hooks/useVSCodeMessaging.ts
console.log('📥 Webview received:', message.type);
console.log('📤 Webview sending:', message.type);
```

---

## ✅ 정상 동작 확인 체크리스트

### 초기 실행
- [ ] F5 누르면 새 창 열림
- [ ] `[Extension Development Host]` 표시됨
- [ ] Console에 "Structured Doc Editor extension is now active" 출력

### 파일 열기
- [ ] `.sdoc` 파일 열면 WYSIWYG 에디터 나타남
- [ ] 툴바 표시됨
- [ ] 샘플 내용이 보기 좋게 렌더링됨
- [ ] Developer Tools 콘솔에 React 에러 없음

### 편집
- [ ] 텍스트 입력 가능
- [ ] Bold/Italic 버튼 클릭 시 즉시 반영
- [ ] 활성화된 포맷은 버튼 하이라이트됨
- [ ] 테이블 삽입 가능

### 저장
- [ ] Ctrl+S 누르면 저장됨
- [ ] `.adoc` 파일이 같은 폴더에 생성됨
- [ ] `.adoc` 파일을 열면 AsciiDoc 형식으로 변환되어 있음

### Undo/Redo
- [ ] 편집 후 Ctrl+Z 누르면 되돌아감
- [ ] `.sdoc` JSON 내용도 함께 되돌아감
- [ ] Ctrl+Shift+Z로 다시 적용됨

### 테마
- [ ] VS Code 테마 변경 시 에디터도 자동으로 색상 변경
- [ ] File > Preferences > Color Theme 에서 테스트

---

## 🎯 실전 시나리오

### 시나리오 1: 새 .sdoc 파일 만들기

1. Extension Development Host에서 새 파일 생성
   ```
   File > New File
   ```

2. 파일 저장
   ```
   Ctrl+S → test.sdoc
   ```

3. 확인:
   - 빈 에디터가 열려야 함
   - 텍스트 입력 가능해야 함

### 시나리오 2: 외부 변경 감지

1. `.sdoc` 파일을 에디터에서 열기

2. 터미널에서 파일 직접 수정
   ```bash
   echo '{"type":"doc","content":[]}' > sample/example.sdoc
   ```

3. 확인:
   - 에디터 내용이 자동으로 업데이트되어야 함

### 시나리오 3: Git 통합 테스트

1. Git 저장소 초기화
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. `.sdoc` 파일 편집 후 저장

3. Git diff 확인
   ```bash
   git diff sample/example.sdoc
   ```
   - Pretty-printed JSON이라 diff가 명확해야 함

---

## 🆘 도움이 필요하면

1. **Output 패널** 확인 (View > Output)
2. **Developer Tools Console** 확인 (Ctrl+Shift+I)
3. **Problems 패널** 확인 (Ctrl+Shift+M)
4. **중단점 설정**하고 단계별 실행

문제가 계속되면 빌드 재실행:
```bash
npm run build
```

Extension Development Host 완전 재시작:
- 원본 창에서 디버그 정지 (빨간 ■ 버튼)
- F5로 다시 시작
