@echo off
chcp 65001 >nul
title 基金阶梯账本
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [未检测到 Node.js]
    echo 请先打开 https://nodejs.org/zh-cn 下载 LTS 版本并安装，然后再双击本文件。
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo 首次运行：正在自动安装依赖（需联网，约 1-2 分钟，请不要关闭本窗口）...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查网络后重新双击本文件。
        pause
        exit /b 1
    )
)

echo 正在启动「基金阶梯账本」，稍候会自动打开浏览器。
echo 若浏览器没有自动打开，请手动访问：http://localhost:5173
echo 关闭本窗口即停止程序。
call npm run start