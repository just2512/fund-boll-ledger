$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
foreach ($command in @("node", "npm", "cargo")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "未找到 $command。请先安装 Node.js、Rust/Cargo、Visual Studio C++ Build Tools 和 WebView2。"
  }
}
$tauriVersion = (& cargo tauri --version 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $tauriVersion -notmatch "2\.11\.4") {
  throw "需要 Tauri CLI 2.11.4。请执行：cargo install tauri-cli --version 2.11.4 --locked"
}
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
cargo tauri icon public/icon.svg
if ($LASTEXITCODE -ne 0) { throw "应用图标生成失败。" }
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw "Windows 原生应用构建失败。" }
Write-Host "Windows 程序构建完成："
Get-ChildItem "src-tauri/target/release" -Filter "fund-boll-ledger.exe" -ErrorAction SilentlyContinue | Select-Object FullName, Length
Get-ChildItem "src-tauri/target/release/bundle/nsis" -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object FullName, Length
