#Requires -Version 5.1
<#
.SYNOPSIS
    Tauri 앱 선택적 빌드 스크립트 (Windows 로컬 빌드 전용)

.DESCRIPTION
    npx tauri build 는 매번 프론트엔드 빌드 + Tauri 코드 생성 + Rust 컴파일 +
    MSI/NSIS 패키징을 전부 수행하기 때문에, "코드 한 줄 고치고 확인" 같은
    반복 작업에는 비효율적입니다.

    이 스크립트는 목적에 맞는 최소 단계만 실행할 수 있도록 -Mode 를 제공합니다.
    (WSL을 사용하지 않는 이 저장소의 로컬 Windows 빌드 흐름 전용입니다.
     WSL 기반 배포 빌드는 저장소 루트의 build-tauri-app.ps1 을 사용하세요.)

.PARAMETER Mode
    - Check   : cargo check 만 실행 (컴파일 에러/경고만 빠르게 확인, exe 생성 안 함)
    - Dev     : npx tauri dev 실행 (HMR + 디버그 빌드, 반복 개발용)
    - Exe     : cargo build --release 만 실행 (설치파일 없이 release exe만 생성)
    - Bundle  : npx tauri build 전체 실행 (프론트엔드 + release exe + 설치파일)

.PARAMETER Bundles
    Mode Bundle 에서만 사용. 생성할 설치파일 타입을 제한합니다. (all, msi, nsis)
    기본값은 all (msi + nsis 둘 다 생성, tauri.conf.json 기준).

.PARAMETER SkipFrontend
    Mode Bundle 에서 프론트엔드(npm run build)가 이미 최신 상태일 때 건너뜁니다.
    (tauri build 는 beforeBuildCommand 를 항상 실행하므로, 이 옵션은
     내부적으로 --bundles 만 지정된 tauri build 를 그대로 쓰고 frontendDist 를
     재사용하고 싶을 때가 아니라, dist/ 를 직접 관리하는 고급 사용자를 위한 것입니다.)

.EXAMPLE
    .\build.ps1 -Mode Check
    .\build.ps1 -Mode Dev
    .\build.ps1 -Mode Exe
    .\build.ps1 -Mode Bundle
    .\build.ps1 -Mode Bundle -Bundles nsis

    -Mode 를 생략하면 번호를 입력해 선택하는 대화형 메뉴가 표시됩니다:
    .\build.ps1
#>
param(
    [ValidateSet("Check", "Dev", "Exe", "Bundle")]
    [string]$Mode,

    [ValidateSet("all", "msi", "nsis")]
    [string]$Bundles = "all",

    [switch]$SkipFrontend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step { param($msg) Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "   ✅ $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "`n❌ $msg" -ForegroundColor Red; exit 1 }

# ──────────────────────────────────────────────
# 대화형 메뉴 (-Mode 미지정 시 숫자 입력으로 선택)
# ──────────────────────────────────────────────
function Read-BuildMode {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Tauri 빌드 - 원하는 작업을 선택하세요" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  1) Check   - cargo check (컴파일 검증만, 가장 빠름)"
    Write-Host "  2) Dev     - npx tauri dev (HMR 개발 모드)"
    Write-Host "  3) Exe     - cargo build --release (exe만 생성)"
    Write-Host "  4) Bundle  - npx tauri build (전체: 설치파일까지 생성)"
    Write-Host "  0) 종료"
    Write-Host ""

    $map = @{ "1" = "Check"; "2" = "Dev"; "3" = "Exe"; "4" = "Bundle" }
    while ($true) {
        $choice = Read-Host "번호 입력 (0-4)"
        if ($choice -eq "0") { Write-Host "종료합니다."; exit 0 }
        if ($map.ContainsKey($choice)) { return $map[$choice] }
        Write-Host "   ⚠ 잘못된 입력입니다. 0~4 중 하나를 입력하세요." -ForegroundColor Yellow
    }
}

function Read-BundleChoice {
    Write-Host ""
    Write-Host "  생성할 설치파일을 선택하세요"
    Write-Host "  1) all   - MSI + NSIS 전부 (기본값)"
    Write-Host "  2) msi   - MSI만"
    Write-Host "  3) nsis  - NSIS만"
    Write-Host ""

    $map = @{ "1" = "all"; "2" = "msi"; "3" = "nsis" }
    while ($true) {
        $choice = Read-Host "번호 입력 (1-3, Enter=1)"
        if ([string]::IsNullOrWhiteSpace($choice)) { return "all" }
        if ($map.ContainsKey($choice)) { return $map[$choice] }
        Write-Host "   ⚠ 잘못된 입력입니다. 1~3 중 하나를 입력하세요." -ForegroundColor Yellow
    }
}

# -Mode 가 지정되지 않았으면 대화형 메뉴로 선택
$IsInteractiveSelection = -not $PSBoundParameters.ContainsKey('Mode')
if ($IsInteractiveSelection) {
    $Mode = Read-BuildMode
}
# Bundle 모드에서 -Bundles 를 명시하지 않고 대화형으로 진입한 경우에만 하위 메뉴 표시
if ($Mode -eq "Bundle" -and $IsInteractiveSelection -and -not $PSBoundParameters.ContainsKey('Bundles')) {
    $Bundles = Read-BundleChoice
}

# 스크립트가 tauri-app/ 어디서 호출되어도 항상 tauri-app 디렉터리 기준으로 동작
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $RepoRoot

try {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Fail "Rust/Cargo 를 찾을 수 없습니다. https://rustup.rs 에서 설치하세요."
    }

    switch ($Mode) {
        "Check" {
            Write-Step "cargo check (컴파일 검증만, exe 생성 없음)"
            cargo check --manifest-path src-tauri/Cargo.toml
            if ($LASTEXITCODE -ne 0) { Write-Fail "cargo check 실패" }
            Write-Ok "cargo check 완료"
        }

        "Dev" {
            Write-Step "npx tauri dev (HMR 개발 모드)"
            npx tauri dev
            if ($LASTEXITCODE -ne 0) { Write-Fail "tauri dev 종료 코드: $LASTEXITCODE" }
        }

        "Exe" {
            Write-Step "cargo build --release (설치파일 없이 exe만 생성)"
            Write-Host "   ⚠ dist/ 가 최신 상태인지 직접 확인하세요 (필요 시 npm run build 먼저 실행)" -ForegroundColor Yellow
            cargo build --release --manifest-path src-tauri/Cargo.toml
            if ($LASTEXITCODE -ne 0) { Write-Fail "cargo build 실패" }
            Write-Ok "빌드 완료: target\release\sdoc-editor.exe"
        }

        "Bundle" {
            if ($SkipFrontend) {
                Write-Host "   ⚠ -SkipFrontend 는 참고용 플래그입니다. tauri build 는" -ForegroundColor Yellow
                Write-Host "     beforeBuildCommand(npm run build)를 항상 실행합니다." -ForegroundColor Yellow
            }
            $bundleArgs = @("tauri", "build")
            if ($Bundles -ne "all") {
                $bundleArgs += @("--bundles", $Bundles)
            }
            Write-Step "npx $($bundleArgs -join ' ') (전체 빌드: 프론트엔드 + release exe + 설치파일)"
            npx @bundleArgs
            if ($LASTEXITCODE -ne 0) { Write-Fail "tauri build 실패" }
            Write-Ok "빌드 완료: target\release\bundle\ 이하 확인"
        }
    }
} finally {
    Pop-Location
}
