#Requires -Version 5.1
<#
.SYNOPSIS
    VS Code Extension VSIX 패키지 빌드 스크립트

.DESCRIPTION
    WSL2 내 프로젝트를 빌드하고 VSIX 파일을 생성합니다.
    생성된 VSIX 파일은 output/ 폴더 및 Windows 바탕화면에 복사됩니다.

    [사전 요구사항]
      WSL2 + Ubuntu (Node.js 18+ 설치된 상태)
      추가 Windows 도구 불필요

.PARAMETER WslDistro
    WSL 배포판 이름 (기본값: Ubuntu)

.PARAMETER WslProjectPath
    WSL 내 프로젝트 경로 (기본값: /home/NaruForge/projects/vscode-ext-customeditor)

.EXAMPLE
    .\build-vsix.ps1
    .\build-vsix.ps1 -SharedFolder ""
#>
param(
    [string]$WslDistro        = "Ubuntu",
    [string]$WslProjectPath   = "/home/NaruForge/projects/vscode-ext-customeditor",
    [string]$SharedFolder     = "D:\CONTROL_NAS\VsCode-Extension\sdoc-editor"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# UTF-8 출력 강제 설정 (WSL 터미널 한글 깨짐 방지)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ──────────────────────────────────────────────
# 색상 헬퍼
# ──────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "   ✅ $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "`n❌ $msg" -ForegroundColor Red; exit 1 }

# ──────────────────────────────────────────────
# WSL 확인
# ──────────────────────────────────────────────
Write-Step "환경 확인 중..."

if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    Write-Fail "WSL 을 찾을 수 없습니다."
}
# wsl --list 출력은 UTF-16(null 바이트 포함) → 제거 후 비교
$wslRaw = wsl --list --quiet 2>$null
$wslCheck = ($wslRaw -replace "`0", "" | Out-String).Trim()
if ($wslCheck -notmatch [regex]::Escape($WslDistro)) {
    Write-Fail "WSL 배포판 '$WslDistro' 를 찾을 수 없습니다.`n   wsl --list  로 이름을 확인하세요."
}
Write-Ok "WSL 배포판: $WslDistro"

$UncProjectPath = "\\wsl$\$WslDistro" + ($WslProjectPath -replace '/', '\')
if (-not (Test-Path $UncProjectPath)) {
    Write-Fail "UNC 경로를 찾을 수 없습니다: $UncProjectPath"
}
Write-Ok "프로젝트 경로: $WslProjectPath"

# ──────────────────────────────────────────────
# STEP 1: Extension 빌드 (esbuild)
# ──────────────────────────────────────────────
Write-Step "Extension 빌드 중 (esbuild)..."
wsl -d $WslDistro -- bash -lc "cd '$WslProjectPath' && npm run build:ext"
if ($LASTEXITCODE -ne 0) { Write-Fail "Extension 빌드 실패" }
Write-Ok "Extension 빌드 완료"

# ──────────────────────────────────────────────
# STEP 2: Webview 빌드 (Vite)
# ──────────────────────────────────────────────
Write-Step "Webview 빌드 중 (Vite)..."
wsl -d $WslDistro -- bash -lc "cd '$WslProjectPath' && npm run build:webview"
if ($LASTEXITCODE -ne 0) { Write-Fail "Webview 빌드 실패" }
Write-Ok "Webview 빌드 완료"

# ──────────────────────────────────────────────
# STEP 3: VSIX 패키징
# ──────────────────────────────────────────────
Write-Step "VSIX 패키징 중..."
wsl -d $WslDistro -- bash -lc "cd '$WslProjectPath' && node scripts/postpackage.mjs"
if ($LASTEXITCODE -ne 0) { Write-Fail "VSIX 패키징 실패" }
Write-Ok "VSIX 패키징 완료"

# ──────────────────────────────────────────────
# 결과물 확인
# ──────────────────────────────────────────────
$OutputUncPath = Join-Path $UncProjectPath "output"
$vsixFile = Get-ChildItem -Path $OutputUncPath -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $vsixFile) {
    Write-Fail "output/ 폴더에서 VSIX 파일을 찾을 수 없습니다."
}

# ──────────────────────────────────────────────
# 공유 폴더로 복사
# ──────────────────────────────────────────────
if ($SharedFolder) {
    if (-not (Test-Path $SharedFolder)) {
        New-Item -ItemType Directory -Path $SharedFolder -Force | Out-Null
        Write-Ok "공유 폴더 생성: $SharedFolder"
    }
    $sharedDest = Join-Path $SharedFolder $vsixFile.Name
    Copy-Item -Path $vsixFile.FullName -Destination $sharedDest -Force
    # version.json 도 함께 복사
    $versionJson = Join-Path $OutputUncPath "version.json"
    if (Test-Path $versionJson) {
        Copy-Item -Path $versionJson -Destination (Join-Path $SharedFolder "version.json") -Force
    }
    Write-Ok "공유 폴더 복사: $sharedDest"
}

# ──────────────────────────────────────────────
# 완료
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  빌드 완료!" -ForegroundColor Green
Write-Host "  VSIX 파일: output\$($vsixFile.Name)" -ForegroundColor White
if ($SharedFolder) {
    Write-Host "  공유 폴더: $SharedFolder\$($vsixFile.Name)" -ForegroundColor White
}
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  VS Code 설치 방법:" -ForegroundColor Gray
Write-Host "    Ctrl+Shift+P → 'Extensions: Install from VSIX...'" -ForegroundColor Gray
