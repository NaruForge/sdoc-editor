#!/usr/bin/env bash
# WSL2 터미널에서 build-vsix.ps1 을 실행하는 래퍼 스크립트
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1_PATH="$(wslpath -w "$SCRIPT_DIR/build-vsix.ps1")"

# PowerShell 7(pwsh) 우선, 없으면 Windows PowerShell 5 사용
if command -v pwsh.exe &>/dev/null; then
  PWSH=pwsh.exe
elif command -v powershell.exe &>/dev/null; then
  PWSH=powershell.exe
else
  echo "❌ PowerShell을 찾을 수 없습니다. Windows PowerShell 또는 PowerShell 7이 필요합니다." >&2
  exit 1
fi

echo "▶  $PWSH 로 실행 중: build-vsix.ps1"
"$PWSH" -ExecutionPolicy Bypass -File "$PS1_PATH" "$@"
