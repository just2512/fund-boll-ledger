param([switch]$Debug)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
foreach ($command in @("node", "npm", "cargo")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "未找到 $command。请先安装 Node.js、Rust/Cargo 和 Tauri 构建环境。"
  }
}
$tauriVersion = (& cargo tauri --version 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $tauriVersion -notmatch "2\.11\.4") {
  throw "需要 Tauri CLI 2.11.4。请执行：cargo install tauri-cli --version 2.11.4 --locked"
}
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
if (-not (Test-Path "src-tauri/gen/android")) {
  cargo tauri android init --ci
  if ($LASTEXITCODE -ne 0) { throw "Android 工程初始化失败。" }
}
cargo tauri icon public/icon.svg
if ($LASTEXITCODE -ne 0) { throw "图标生成失败。" }
$arguments = @("tauri", "android", "build", "--apk", "--target", "aarch64", "--ci")
if ($Debug) { $arguments += "--debug" }
& cargo @arguments
if ($LASTEXITCODE -ne 0) { throw "Android APK 构建失败，请检查 Android Studio、JDK、SDK 和 NDK 配置。" }
Write-Host "APK 构建完成。"
Get-ChildItem "src-tauri/gen/android/app/build/outputs/apk" -Filter "*.apk" -Recurse | Select-Object FullName, Length
