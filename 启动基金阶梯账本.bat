@echo off
chcp 65001 >nul
setlocal
title 基金阶梯账本（原生桌面版）
cd /d "%~dp0"

set "APP_EXE=%~dp0src-tauri\target\release\fund-boll-ledger.exe"

rem 优先启动已经构建好的 Windows 独立应用，不启动浏览器。
if exist "%APP_EXE%" (
    start "" "%APP_EXE%"
    exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
    echo [缺少 Node.js]
    echo 请安装 Node.js 20 或更高版本。
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [缺少 Rust 原生构建环境]
    echo 推荐使用构建完成的 Windows 安装包。
    echo 本脚本不会退回浏览器模式。
    echo 开发环境需安装 Rust、Visual Studio C++ Build Tools 和 WebView2。
    pause
    exit /b 1
)

cargo tauri --version >nul 2>nul
if errorlevel 1 (
    echo [缺少 Tauri CLI]
    echo 请在 PowerShell 执行：
    echo cargo install tauri-cli --version 2.11.4 --locked
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 首次运行：正在安装前端依赖……
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

echo 正在启动基金阶梯账本原生窗口……
call cargo tauri dev
if errorlevel 1 (
    echo 原生窗口启动失败。请检查 Node.js、Rust、C++ Build Tools 和 WebView2 环境。
    pause
    exit /b 1
)
