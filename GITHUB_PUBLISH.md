# 原生桌面版和 Android App 构建

本仓库已存在。此文档用于构建 Windows 桌面程序和 Android APK。

## Windows 桌面应用

依赖：Node.js 20+、Rust stable/MSVC toolchain、Visual Studio C++ Build Tools、WebView2 Runtime。

    npm install
    cargo install tauri-cli --version 2.11.4 --locked
    cargo tauri icon public/icon.svg
    npm run desktop:dev
    npm run desktop:build

构建后：
- 安装程序：src-tauri/target/release/bundle/nsis/
- 可执行文件：src-tauri/target/release/fund-boll-ledger.exe

双击根目录的 启动基金阶梯账本.bat。它优先启动已构建的 exe，否则在原生构建工具链齐备时启动 Tauri 独立窗口；不会使用 vite --open 打开浏览器。

## Android APK（OPPO Find N2 使用 ARM64）

依赖：Android Studio、JDK 21、Android SDK Platform 36、SDK Build Tools、NDK、Rust Android target。

    npm install
    cargo install tauri-cli --version 2.11.4 --locked
    cargo tauri icon public/icon.svg
    cargo tauri android init --ci
    cargo tauri android build --apk --target aarch64 --ci

APK 在 src-tauri/gen/android/app/build/outputs/apk/ 下的架构目录中。PUG110 对应 ARM64（aarch64）构建。

## 可选 GitHub Actions

.github/workflows/native-build.yml 是手动触发工作流，不会因每次 push 自动消耗 Actions 用量。成功后可从 Actions 运行页下载 Windows 安装包与 Android APK artifact。

## 注意事项

- 本项目只手动记账，不连接东方财富或券商。
- Windows 与 Android 的本地数据库不是自动同步的。跨设备使用时通过 JSON 备份/恢复。
- 原生安装包需实机验收。浏览器视口测试不等于已在 OPPO Find N2 或 Android 16 实机验证。
- 不要将实际交易账本和备份文件提交到仓库。
