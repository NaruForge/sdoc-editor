#!/usr/bin/env bash
# WSL2 터미널에서 build-vsix.ps1 을 실행하는 래퍼 스크립트
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# PowerShell 7(pwsh) 우선, 없으면 Windows PowerShell 5 사용
if command -v pwsh.exe &>/dev/null; then
  PWSH=pwsh.exe
elif command -v powershell.exe &>/dev/null; then
  PWSH=powershell.exe
else
  echo "❌ PowerShell을 찾을 수 없습니다. Windows PowerShell 또는 PowerShell 7이 필요합니다." >&2
  exit 1
fi

# 현재 WSL 배포판 이름을 자동으로 전달 (wsl --list 인코딩 문제 우회)
Wsl_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"

# PowerShell 5는 BOM 없는 UTF-8 파일을 ANSI로 읽어 한글이 깨짐
# → 임시 파일에 UTF-8 BOM을 붙여 실행 (PS7은 BOM 없이도 정상)
TEMP_PS1=$(mktemp /tmp/build-vsix-XXXXXX.ps1)
printf '\xef\xbb\xbf' > "$TEMP_PS1"
cat "$SCRIPT_DIR/build-vsix.ps1" >> "$TEMP_PS1"
PS1_WIN=$(wslpath -w "$TEMP_PS1")

echo "▶  $PWSH 로 실행 중: build-vsix.ps1 (배포판: $Wsl_DISTRO)"
"$PWSH" -ExecutionPolicy Bypass -File "$PS1_WIN" -WslDistro "$Wsl_DISTRO" "$@"
EXIT_CODE=$?

rm -f "$TEMP_PS1"
exit $EXIT_CODE
