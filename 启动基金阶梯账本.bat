@echo off
chcp 65001 >nul
setlocal
title 基金阶梯账本
cd /d "%~dp0"

set "APP_EXE=%~dp0src-tauri\target\release\fund-boll-ledger.exe"

rem 1) 优先启动已经构建好的原生桌面程序（独立窗口，不打开浏览器）。
if exist "%APP_EXE%" (
    start "" "%APP_EXE%"
    exit /b 0
)

rem 2) 原生程序未构建时，退回网页版（只需 Node.js，不需要 Rust）。
where node >nul 2>nul
if errorlevel 1 (
    echo [缺少 Node.js]
    echo 原生桌面程序尚未构建，网页版启动也需要 Node.js。
    echo 请先安装 Node.js LTS：https://nodejs.org/
    echo 装完重新双击本文件，即可用网页版打开。
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 首次运行：正在安装前端依赖（需联网约 1-2 分钟，请勿关闭）...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络后重新双击本文件。
        pause
        exit /b 1
    )
)

echo 未检测到原生桌面程序，已改用网页版打开（通过浏览器窗口）。
echo 想要真正的独立窗口：
echo   1^) 在 GitHub 仓库 Actions 里手动运行 Native App Build，下载安装包；或
echo   2^) 本机安装 Rust + Visual Studio C++ Build Tools 后，执行 .\scripts\build-windows.ps1
echo.
call npm run start:web