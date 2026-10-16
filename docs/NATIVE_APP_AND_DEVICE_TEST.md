# 原生应用与 OPPO Find N2 验证说明

## 当前架构

- Windows：Tauri 2.11.5 独立桌面窗口；默认窗口 1220×850，最小 900×640。不会调用默认浏览器。
- Android：Tauri Android 工程；构建面向 ARM64（aarch64）的 APK，最低 Android API 24。
- 界面：共用 src/App.tsx 与 src/styles.css，不维护单独的 Android 页面。
- 数据：保存在每台设备自己的 IndexedDB 中，没有自动云同步。

## OPPO Find N2（PUG110）

PUG110 对应 ARM64 Android 设备，因此应使用 --target aarch64 生成的 APK，而不是仅生成 32 位 ARMv7 APK。

布局通过动态视口单位、safe-area 和断点做自适应：
- 折叠外屏窄视口：竖向堆叠价格输入、对比卡片、账本表单。
- 展开内屏：使用更宽的两列/多列布局，避免字号过小。
- 横屏：减少头部和面板的垂直留白，弹窗允许滚动。
- 软件键盘：使用 interactive-widget=resizes-content 与 100dvh，尽量避免表单操作区被遮住。

以上是代码层面的设计和浏览器视口回归测试，不代表已在 PUG110 真机上验证，也不承诺 OPPO 固件特定的 WebView 行为全部无差异。

## Android 16

构建配置锁定在 Tauri 2.11 系列，目标是 API 36 的 Android 16 构建环境。安装成功与否仍取决于实际 APK、设备固件、WebView 与系统安装策略。当前环境没有连接你的 PUG110 真机，因此不能声称已完成实机兼容测试。

## Windows 首次准备

1. 安装 Node.js 20+。
2. 安装 Rust stable、Visual Studio C++ Build Tools 与 WebView2 Runtime。
3. 执行 cargo install tauri-cli --version 2.11.4 --locked。
4. 执行 scripts/build-windows.ps1。
5. 运行生成的 NSIS 安装包，从开始菜单/桌面快捷方式启动；或者在代码目录双击 启动基金阶梯账本.bat 启动已构建程序。

## Android 首次准备

1. 安装 Android Studio 和 JDK 21。
2. 在 SDK Manager 安装 Android SDK Platform 36、相应 Build Tools、NDK 和 CMake。
3. 安装 Rust stable，并添加 aarch64-linux-android target。
4. 执行 scripts/build-android.ps1。
5. 将输出的 ARM64 APK 传到手机安装；首次安装会提示允许当前来源安装应用。

## 必须做的真机验收

- [ ] APK 能安装、启动、退出并重新打开。
- [ ] 折叠、展开、横竖屏切换后价格输入及十档表格无页面级横向溢出。
- [ ] 软件键盘弹出后能滚动到当前焦点和保存按钮。
- [ ] 输入五个基准与当前价，五基准涨跌额/幅实时重算。
- [ ] 十档已越过、下一档、超出十档范围标记正确。
- [ ] 新建基金、买入、卖出、费用与盈亏保存后，强制关闭再打开数据仍在。
- [ ] JSON 备份导出、导入恢复有效；导入前会提示替换本机数据。
- [ ] 确认当前价格只是手动输入，不是行情接口推送的实时数据。
