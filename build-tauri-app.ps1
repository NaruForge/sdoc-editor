#Requires -Version 5.1
<#
.SYNOPSIS
    Tauri 앱 (Windows 네이티브) 빌드 스크립트

.DESCRIPTION
    WSL2 내 프로젝트의 Tauri 앱을 Windows 실행 파일(.exe, .msi, .nsis)로 빌드합니다.

    [사전 요구사항 - Windows 쪽에 설치 필요]
      1. Rust (https://rustup.rs) — MSVC toolchain 포함
      2. Visual Studio C++ Build Tools (또는 Visual Studio)
      3. Node.js 18+ (https://nodejs.org)
      4. WebView2 Runtime (Windows 11은 기본 내장)

.PARAMETER WslDistro
    WSL 배포판 이름 (기본값: Ubuntu)

.PARAMETER WslProjectPath
    WSL 내 프로젝트 경로 (기본값: /home/NaruForge/projects/vscode-ext-customeditor)

.PARAMETER SkipFrontendBuild
    프론트엔드 빌드를 건너뛰고 싶을 때 사용 (이미 dist/ 가 최신인 경우)

.EXAMPLE
    .\build-tauri-app.ps1
    .\build-tauri-app.ps1 -SkipFrontendBuild
    .\build-tauri-app.ps1 -WslDistro Ubuntu-22.04
#>
param(
    [string]$WslDistro = "Ubuntu",
    [string]$WslProjectPath = "/home/NaruForge/projects/vscode-ext-customeditor",
    [switch]$SkipFrontendBuild
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
function Write-Warn  { param($msg) Write-Host "   ⚠️  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "`n❌ $msg" -ForegroundColor Red; exit 1 }

# ──────────────────────────────────────────────
# 사전 요구사항 체크
# ──────────────────────────────────────────────
Write-Step "사전 요구사항 확인 중..."

# Node.js (Windows 네이티브)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js 가 Windows PATH에 없습니다.`n   설치: https://nodejs.org"
}
$nodeVer = node --version
Write-Ok "Node.js $nodeVer"

# Cargo/Rust (Windows 네이티브 — MSVC toolchain)
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Fail "Rust/Cargo 가 Windows PATH에 없습니다.`n   설치: https://rustup.rs (기본 MSVC toolchain 선택)"
}
$cargoVer = cargo --version
Write-Ok "Rust  $cargoVer"

# WSL 확인
if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    Write-Fail "WSL 을 찾을 수 없습니다."
}
$wslCheck = wsl --list --quiet 2>$null
if ($wslCheck -notmatch $WslDistro) {
    Write-Fail "WSL 배포판 '$WslDistro' 를 찾을 수 없습니다.`n   wsl --list  로 이름을 확인하세요."
}
Write-Ok "WSL 배포판: $WslDistro"

# ──────────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────────
$TauriRelPath  = "tauri-app"
$WslTauriPath  = "$WslProjectPath/$TauriRelPath"
# Windows에서 WSL 파일시스템 접근용 UNC 경로
$UncTauriPath  = "\\wsl$\$WslDistro" + ($WslTauriPath -replace '/', '\')

if (-not (Test-Path $UncTauriPath)) {
    Write-Fail "UNC 경로를 찾을 수 없습니다: $UncTauriPath`n   WSL 경로(WslProjectPath)를 확인하세요."
}
Write-Ok "프로젝트 경로: $UncTauriPath"

# ──────────────────────────────────────────────
# STEP 1: npm install (Windows-side, UNC 경로)
# ──────────────────────────────────────────────
Write-Step "npm install (tauri-app)..."
Push-Location $UncTauriPath
try {
    npm install --prefer-offline 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm install 실패" }
    Write-Ok "의존성 설치 완료"
} finally { Pop-Location }

# ──────────────────────────────────────────────
# STEP 2: 프론트엔드 빌드 (WSL에서 실행 — vite build가 WSL 환경에서 더 안정적)
# ──────────────────────────────────────────────
if (-not $SkipFrontendBuild) {
    Write-Step "프론트엔드 빌드 (WSL: npm run build)..."
    wsl -d $WslDistro -- bash -lc "cd '$WslTauriPath' && npm run build"
    if ($LASTEXITCODE -ne 0) { Write-Fail "프론트엔드 빌드 실패" }
    Write-Ok "프론트엔드 빌드 완료 → dist/"
} else {
    Write-Warn "-SkipFrontendBuild 플래그: 프론트엔드 빌드 건너뜀"
}

# ──────────────────────────────────────────────
# STEP 3: Tauri 빌드 (Windows 네이티브 Cargo)
# ──────────────────────────────────────────────
Write-Step "Tauri 빌드 (Windows Rust toolchain)..."
Push-Location $UncTauriPath
try {
    npx @tauri-apps/cli build 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { Write-Fail "tauri build 실패" }
    Write-Ok "Tauri 빌드 완료"
} finally { Pop-Location }

# ──────────────────────────────────────────────
# STEP 4: Portable EXE 복사
# ──────────────────────────────────────────────
Write-Step "Portable EXE 생성 중..."
Push-Location $UncTauriPath
try {
    node scripts/copy-portable.mjs 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { Write-Warn "copy-portable.mjs 실패 (빌드 자체는 성공)" }
} finally { Pop-Location }

# ──────────────────────────────────────────────
# 완료: 결과물 위치 출력
# ──────────────────────────────────────────────
$BundleDir = Join-Path $UncTauriPath "target\release\bundle"
Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  빌드 완료!" -ForegroundColor Green
Write-Host "  결과물 위치: $BundleDir" -ForegroundColor White
Write-Host "  ├─ msi\    — Windows MSI 설치파일" -ForegroundColor Gray
Write-Host "  ├─ nsis\   — NSIS 설치파일" -ForegroundColor Gray
Write-Host "  └─ portable\ — 포터블 EXE" -ForegroundColor Gray
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
