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

## BOLL + MACD 原生端外部验收

浏览器 E2E 已覆盖面板存在性、折叠交互、文案和模拟窄屏布局；以下项目必须在 Windows 原生程序或 Android APK 中确认，不能仅凭浏览器测试勾选。

### 1. 构建产物获取

推荐从 GitHub Actions 手动运行：

1. 打开仓库 **Actions**。
2. 选择 **Native App Build (manual)**。
3. 选择分支 `main`，点击 **Run workflow**。
4. 等待 `Windows desktop installer` 与 `Android ARM64 ephemeral-signed smoke APK (not upgradeable)` 两个 job 均完成。
5. 从该次 run 的 Artifacts 下载：
   - `fund-boll-ledger-windows-x64`
   - `fund-boll-ledger-android-arm64-debug-only`

Android debug APK 是临时调试签名，**不可用于覆盖升级已有正式签名安装**。若设备上已有正式版，先在应用内导出 JSON 备份；不要为安装 debug APK 直接卸载正式版，除非已确认本机数据已备份且接受卸载清除应用数据。只有仓库已启用持久签名配置时，条件 job `Android ARM64 signed release (upgrade-compatible)` 才会运行；其产物为 `fund-boll-ledger-android-arm64-release-upgradeable`。

### 2. 技术状态面板验收（Windows 与 Android 均执行）

准备一只已有足够历史数据的 ETF，点击刷新行情，打开价格对比模块中的 **BOLL + MACD 技术状态**，逐项核对：

- [ ] 首屏综合描述与日/周/月详细卡片均显示；面板仍在原价格对比模块内。
- [ ] 日、周、月分别显示 K 线来源、现价来源、历史覆盖区间、确认 K 线数量和最后确认日期；不得把本机刷新时间冒充行情日期。
- [ ] BOLL 显示上轨/中轨/下轨、BBW、历史分位、带宽阶段、中轨方向和确认收盘位置；数值应与当前周期已确认 K 线相对应。
- [ ] MACD 显示零轴位置、DIF/DEA 排列、柱体动能描述和本根交叉事件；“本根新金叉/本根新死叉”只表示本根新事件，不得与持续排列混淆。
- [ ] 周线/月线最后确认日期应对应已结束周期；未收盘周期不得被当作已确认数据。
- [ ] 历史不足、来源不可用或数据无效时，界面明确显示历史不足/未知/不可用原因，不得补造 BOLL 或 MACD 状态。
- [ ] 面板及综合描述只陈述指标状态，不出现买入、卖出或仓位建议。
- [ ] 折叠、展开面板后，价格对比卡片和技术状态内容均可正常恢复；切换基金后不串用上一只基金的状态。

若当前基金的周线或月线确认历史少于 MACD 稳定发布门槛（日 160、周 160、月 100 根），MACD 应显示历史不足，而不是强行展示稳定状态。不要为了让面板出现完整状态而降低门槛。

### 3. OPPO Find N2（PUG110）真机验收补充

除上面的技术状态项目外，必须在外屏、展开内屏、横屏分别打开 BOLL + MACD 详情：

- [ ] 外屏技术状态卡片可读，BOLL/MACD 字段不被裁切，页面无横向滚动条。
- [ ] 展开内屏后卡片合理利用宽度，字段仍可辨认，不出现大面积空白或卡片重叠。
- [ ] 横屏下技术详情可滚动，页面和弹层不被系统状态栏/导航栏遮挡。
- [ ] 刷新行情时能区分加载中、成功和来源失败；失败时保留错误信息，不显示旧数据为刚刚刷新成功。
- [ ] 系统返回、切换应用再返回、强制关闭后重开，应用可正常恢复；本地账本数据未意外丢失。

### 4. 验收记录提交格式

完成后记录以下信息，未实际执行的项目保持未勾选：

- Git commit SHA：
- Native workflow run URL：
- Windows artifact 安装/启动结果：
- Android APK 文件名、签名类型、安装结果：
- OPPO Find N2 外屏/内屏/横屏结果：
- BOLL + MACD 日/周/月状态展示结果：
- 行情来源失败或历史不足时的实际表现：
- 发现的问题（附截图、设备系统版本、复现步骤）：

**边界：** CI 成功只证明构建/自动化检查通过；APK 能安装不等于技术状态数据正确；浏览器视口通过不等于 OPPO 真机通过。外部验收结果未回填前，不得声明原生端/真机验收完成。
