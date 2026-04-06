#!/usr/bin/env bash
# WSL2 터미널에서 build-vsix.ps1 을 실행하는 래퍼 스크립트
set -euo pipefail

# bash 측 로케일을 UTF-8로 강제 (터미널 한글 깨짐 방지)
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

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

# 현재 WSL 배포판 이름을 자동으로 전달 (wsl --list 인코딩 문제 우회)
Wsl_DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"

echo "▶  $PWSH 로 실행 중: build-vsix.ps1 (배포판: $Wsl_DISTRO)"
# UTF-8 코드 페이지 강제 설정 후 스크립트 실행 (한글 깨짐 방지)
# pwsh(PS7)은 -OutputEncoding 지원, powershell.exe(PS5)는 chcp 65001로 우회
if [[ "$PWSH" == "pwsh.exe" ]]; then
  "$PWSH" -ExecutionPolicy Bypass -File "$PS1_PATH" -WslDistro "$Wsl_DISTRO" "$@"
else
  "$PWSH" -ExecutionPolicy Bypass -NoProfile \
    -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; & '$PS1_PATH' -WslDistro '$Wsl_DISTRO'"
fi
