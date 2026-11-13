# Execution Ledger

This file is the human-readable recovery index. The authoritative item-by-item status is **[TECHNICAL_STATE_REQUIREMENTS.json](TECHNICAL_STATE_REQUIREMENTS.json)**; do not duplicate or manually override its statuses here.

## Active scope

BOLL + MACD technical-state calculation and factual description inside the existing price-comparison module only.

Explicitly excluded: strategy backtesting, order/fill simulation, position/capital/fee/slippage/return calculations, trade instructions, new standalone pages, and ledger schema changes.

## Required reading order after any interruption or new session

1. [EXECUTION_CONTRACT.md](EXECUTION_CONTRACT.md)
2. [BOLL_MACD_INFORMATION_ARCHITECTURE.md](BOLL_MACD_INFORMATION_ARCHITECTURE.md) — 本轮 BOLL + MACD 信息架构和数据管线强制约束
3. [BOLL_MACD_ACCEPTANCE.md](BOLL_MACD_ACCEPTANCE.md) — 本轮强制验收清单和 BLOCKED 规则
4. [TECHNICAL_STATE_ANALYSIS_IMPLEMENTATION_PLAN.md](TECHNICAL_STATE_ANALYSIS_IMPLEMENTATION_PLAN.md), especially sections 24–26; if older UI wording conflicts, the new information architecture takes precedence
5. [TECHNICAL_STATE_SOURCE_AUDIT.md](TECHNICAL_STATE_SOURCE_AUDIT.md)
6. [BOLL_MACD_CALIBRATION_REPORT.md](BOLL_MACD_CALIBRATION_REPORT.md)
7. [TECHNICAL_STATE_REQUIREMENTS.json](TECHNICAL_STATE_REQUIREMENTS.json)
8. Current main commit, working tree, latest frontend CI, latest technical-state calibration run, and native build/device acceptance status

Do not continue from chat memory alone. Reconcile the matrix with the actual current source and CI before changing any status.

## Completion rule

A requirement is PASS only when its current implementation, acceptance tests and traceable evidence are present. A green CI run does not automatically close every requirement. Any item without evidence remains MISSING, UNKNOWN, IN_PROGRESS or BLOCKED. Never delete a requirement to make the matrix green.

## Current implementation boundaries

- BOLL uses the explicit daily/weekly/monthly descriptive reference configuration in `src/technical-state/config.ts`; it is not a trading threshold or optimized strategy.
- MACD status is not published before the empirical confirmed-history minimum: daily 160, weekly 160, monthly 100 bars.
- Historical replay uses confirmed-bar prefixes and checks for future-data leakage.
- The UI remains inside the existing price-comparison module; the selected daily/weekly/monthly period directly shows its full evidence. No nested details, drawer, or second expansion is allowed. The outer price-comparison module may retain its existing collapse behavior.
- Fund/Trade/Snapshot persistence structures are unchanged.
- The two out-of-scope strategy experiment branches are reset to main; no backtest code is retained or merged.

## Separate verification boundary

The frontend browser CI runs on PR updates. `.github/workflows/native-build.yml` runs for relevant PR paths and manual dispatch. The 2026-11-13 PR #6 synchronized head `b8757f4e7b61770708f4eb09e3ee191f4053ddb5` passed the Windows installer and Android ARM64 Debug smoke APK cloud builds (Native App Build Run [43346104077](https://github.com/just2512/fund-boll-ledger/actions/runs/43346104077)). These results prove successful packaging and upload, not local installation or physical-device operation. Windows local installation/launch, ledger and JSON recovery, Android installation/runtime and OPPO Find N2 physical-device checks remain post-merge tasks; Android persistent-signing Release was skipped because its signing configuration is not enabled.

## 2026-11-10 recovery checkpoint

- Latest reviewed baseline before this recovery: `cf85b720e619ba1608b75a14af57ef7ecea42863`.
- Production data flow injects the versioned BOLL config and UI consumes the combined technical-state description; the old T-06 note claiming it was not connected to UI was stale.
- Corrected the BOLL UI explanatory copy and added an E2E assertion. T-00, T-06 and T-09 are PASS with source, E2E and latest CI evidence in the matrix.
- Native Windows/Android build remains unverified. The workflow is manual-only and the available GitHub connection has no workflow-dispatch write operation. Physical OPPO Find N2 external/inner display testing is also not evidenced.
- Do not mark native build or physical-device acceptance PASS from browser viewport tests.

## 2026-11-10 原生端外部验收交接

- 当前 main：`b21bbc3874e95662ffce0d0e8273e54d2429037f`。
- 最新前端 CI Run [42736764289](https://github.com/just2512/fund-boll-ledger/actions/runs/42736764289)：两个 job 均 completed/success；单测、执行契约/升级契约、类型检查、生产构建、Playwright 浏览器 E2E 均完成。
- 本次检查确认 `.github/workflows/native-build.yml` 仍为手动触发；工作流包含 Windows installer、Android ARM64 临时 debug smoke APK，以及仅在持久签名配置启用时运行的 Android release APK。
- 当前连接没有 GitHub Actions workflow-dispatch 写操作，未代替用户触发原生构建。新增/补全 `docs/NATIVE_APP_AND_DEVICE_TEST.md` 中的产物获取、签名风险、BOLL + MACD 原生端检查项和 OPPO Find N2 真机检查项，供用户拉取 `main` 后执行。
- Android debug APK 明确不可覆盖升级正式签名版本；卸载前必须先导出 JSON 备份，避免丢失本机 IndexedDB 数据。
- 外部 Windows/Android 构建和设备验收仍未取得结果；本项状态为待外部执行，不将前端 CI 或浏览器视口结果冒充原生验收。

## 2026-11-10 Windows 原生构建门禁故障与修复

- Native workflow Run [42738326328](https://github.com/just2512/fund-boll-ledger/actions/runs/42738326328) 已实际执行：Android ARM64 ephemeral-signed smoke APK job 成功并上传 artifact `fund-boll-ledger-android-arm64-debug-only`；Windows job 在 `Verify upgrade contract` 阶段失败，未生成 Windows 安装包；Android 持久签名 Release job 因 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用而跳过。
- Windows 失败根因已从日志和源码定位：`scripts/verify-upgrade-contract.mjs` 用仅接受 LF 的正则解析 `src-tauri/Cargo.lock`，Windows checkout 文件为 CRLF，导致 `cargoLock` 版本捕获为 `undefined`。其余五处版本字段均为 `0.2.0`，并非真实版本不一致。
- 已在提交 `2e842511b82713900861315e8f42342bcd1e40ab` 修正解析器，允许 LF/CRLF：`/\\[\\[package\\]\\]\\r?\\nname ... \\r?\\nversion .../`。没有放宽版本校验条件，也没有改变升级身份、签名或数据迁移门槛。
- 修复提交触发前端 CI Run [42743013645](https://github.com/just2512/fund-boll-ledger/actions/runs/42743013645)：单测/类型检查/生产构建 job 已成功；浏览器 E2E 尚在执行，不能提前标记整次 CI 成功。
- 重新触发 Native App Build (manual) 仍需从 Actions 页面手动选择 `main`；当前 GitHub 连接没有 workflow-dispatch 写操作。Android debug artifact 只用于安装冒烟测试，不可覆盖升级正式签名版。


## 2026-11-10 UI 系统版本升级 0.3.0

- 版本从 `0.2.0` 升级为 `0.3.0`；Android versionCode 按仓库编码规则从 `2000` 更新为 `3000`。
- 升级前回退基线：`72354042108c43d65f59ecd8f74d20baf1339d50`；回退分支：`rollback/ui-v0.3.0-baseline`。该分支锚定升级前完整代码，不触碰用户本地 IndexedDB 数据。
- 实施范围与验收清单见 [UI_UPGRADE_0.3.0.md](UI_UPGRADE_0.3.0.md)。
- UI 实施：顶部行情摘要胶囊及轻量毛玻璃；日/周/月单选横向手风琴（窄屏纵向折叠）；指标明细托盘；刷新成功/失败反馈；减少动效支持。
- 版本字段已同步 package/package-lock、Cargo.toml/Cargo.lock、Tauri 配置；升级契约改为 package version 单一来源，并按版本规则校验 Android versionCode；原应用 ID、Windows 安装身份和本地数据身份保持不变。
- E2E 增加顶部摘要、周期互斥展开、360px 无横向溢出和 reduced-motion 检查。
- 尚未以本台账记录 CI 最终结果、Windows 安装包、Android 持久签名 Release 或 OPPO Find N2 真机结果；这些必须以对应工作流和设备证据补记，不能以源码提交代替验收。


## 2026-11-12 BOLL/MACD 异常边界与计算复用恢复点

- 当前工作分支：work/technical-state-information-architecture。
- 当前功能分支最新代码提交：4bf0c5e892e41888fda106b551cb9c9218ddbe05；历史计算复用实现位于其祖先提交，性能基准脚本位于 b5d229b4261ef0885244e270922590ce8437840f。
- 最近完整前端 CI：Run [43153961302](https://github.com/just2512/fund-boll-ledger/actions/runs/43153961302)，14 个测试文件通过，134 passed / 2 skipped；benchmark、TypeScript、生产构建、执行契约和升级契约通过；Playwright 48/48 通过。
- 已消除每周期快照中重复的 BOLL 全历史点计算和 MACD 全历史序列构建；复用历史序列前校验长度、日期和收盘价，并通过等价性与错位拒绝测试。没有改变 BOLL/MACD 公式、EMA 初始化、确认 K 线、稳定发布门槛或历史事件语义。
- 1,000 根日线的单次 CI 基准：BOLL 从 296.43 到 356.55 ops/s（1.20x）；MACD 从 1,277.39 到 2,269.16 ops/s（1.78x）。Vitest bench 是实验性基准，单次 GitHub-hosted runner 数据不能外推为物理设备性能。
- 已补充 UI 异常路径：没有确认历史时显示“无可确认历史 K 线”；K 线三源失败显示 UNAVAILABLE 和源端失败原因；现价源全部失败时摘要显示真实错误；保留旧行情时明确提示“上次成功数据”。
- 账本隔离复核：Fund、Trade、PriceSnapshot、AppData 不包含技术状态；MarketQuote.technicalState 只作为行情响应的临时派生字段，JSON 导出序列化的是 AppData，未改动持久化 schema。
- PR #4 仍 open、未合并；当前分支相对 main behind 0。不得擅自合并。
- 真实数据专项验收已在当前工作分支重新运行：Run [43153956310](https://github.com/just2512/fund-boll-ledger/actions/runs/43153956310)，第二次 attempt success；510300 实时验收通过，4 ETF × 3 周期共 12 组、7,351 根确认 K 线，no-future-bars 与最终批量一致性全部通过。标准前端 CI 中的两个 live-data 测试仍 skipped，但已由该专用 workflow 实际执行并通过。
- 外部阻断仍只有 Windows Tauri、Android ARM64 和 OPPO Find N2 真机验收未执行；浏览器 E2E 不替代原生/真机验收。

- Live calibration workflow 已加入 work/technical-state-information-architecture 分支的 push 触发，仅在技术计算相关路径变化时运行；移除 PR 事件触发以避免同一提交重复执行。workflow_dispatch 保留。

- 持久化边界新增 E2E：在行情派生技术状态已生成后导出 JSON，确认只包含账本字段，不包含 technicalState/formulaVersion；AppData/IndexedDB schema 不变。


## 2026-11-12 原生构建与当前 head CI 复核

- 当前 PR head：`5604bcde85929144ee2b4ba9cae69790dafb78cc`；PR #4 仍 open、未合并，feature branch 相对 main behind 0。
- 最新前端 CI [Run 537](https://github.com/just2512/fund-boll-ledger/actions/runs/43155831276)：unit/build/benchmark/contract job 与 browser E2E job 均成功。
- 原生构建 [Run 8](https://github.com/just2512/fund-boll-ledger/actions/runs/43155823629)：Windows installer 成功；Android ARM64 debug-only APK 编译、临时签名、apksigner 验证和 artifact 上传成功。Artifacts：Windows `fund-boll-ledger-windows-x64`（ID `13917120140`）；Android `fund-boll-ledger-android-arm64-debug-only`（ID `13916337229`），均于 2026-11-26 到期。
- 前一原生 run [43154632857](https://github.com/just2512/fund-boll-ledger/actions/runs/43154632857) 的 Android artifact copy 因目标路径包含分支斜杠失败；已在提交 `5604bcde85929144ee2b4ba9cae69790dafb78cc` 改为平面文件名，Run 8 已验证修复。
- Android 持久签名 release job 因未启用 `ANDROID_RELEASE_SIGNING_ENABLED` 跳过；debug APK 不可覆盖升级正式签名版。
- Windows/Android 原生构建现有 CI 证据，不再列为 BLOCKED；Windows 桌面窗口、Android 安装运行及 OPPO Find N2 外屏/内屏/横竖屏/输入法检查仍 BLOCKED，必须取得真实设备证据后才能关闭。


## 2026-11-12 多规模性能与 reload 隔离复核

- 当前代码分支 head：`d43773ff0ece483f68d861994e41d9f0fb401d14`。
- 当前 head 前端 CI [Run 43162737208](https://github.com/just2512/fund-boll-ledger/actions/runs/43162737208)：14 个单测文件通过，134 passed / 2 skipped；执行契约、升级契约、benchmark、TypeScript、生产构建通过；Playwright 48/48 通过。
- 新增 reload E2E：行情刷新后技术状态出现；reload 后本地账本现价恢复，但技术状态回到未刷新状态、公式版本不再显示；再次手动刷新后技术状态重建。确认派生状态不跨 reload 持久化。
- 多规模 Vitest benchmark 覆盖 240/1,000/2,000/5,000 根。MACD 历史复用四档耗时均低于重复独立计算；BOLL 变化幅度较小，2,000 根档复用路径略慢，暂不据单次基准增加优化。5,000 根为合成压力输入，不代表行情源可返回 5,000 根。
- 本轮 benchmark 类型错误与 E2E 断言错误均已按实际日志修正，最终 Run 43162737208 通过；失败 run 保留。
- PR #4 仍 open、未合并；当前 feature branch 与 main 比较 ahead 121 / behind 0（以本记录生成时 compare 结果为准）。
- T-09 仍 BLOCKED：Windows 桌面实际操作、Android 安装运行、OPPO Find N2 外屏/内屏/横竖屏/输入法真机验收；Android 持久签名 release 仍未启用。


## 22. 最新原生构建结果与后续交付门槛（2026-11-12）

- 复核工作流：[Native App Build Run 43162417531](https://github.com/just2512/fund-boll-ledger/actions/runs/43162417531)。
- **PASS：Windows desktop installer job**。工作流步骤全部成功：checkout、Node/Rust toolchain、依赖安装、升级契约、Tauri CLI、图标生成、测试/桌面构建、artifact 上传。
- **PASS：Android ARM64 debug-only smoke APK job**。SDK/NDK 与 ARM64 Rust target 配置、Gradle、APK 构建、临时 debug keystore 签名、zipalign、apksigner 验证及 artifact 上传均成功。
- **SKIPPED：Android ARM64 signed release job**。仓库变量 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用；当前没有证据表明已配置持久签名身份，不能产出可覆盖升级正式版的 APK。
- **BLOCKED：外部设备验收**。Windows 安装包尚无桌面实际操作证据；Android APK 尚无安装/启动证据；OPPO Find N2（PUG110）外屏、展开内屏、横竖屏、输入法和真实行情下 BOLL/MACD 详情检查尚未执行。此类操作依赖用户可接触的实体设备，云端 CI 无法代替。
- 后续工作顺序：①取得并安装本次 Windows/Android artifact，先执行启动、备份恢复和账本回归；②在 Find N2 上按 `docs/NATIVE_APP_AND_DEVICE_TEST.md` 逐项验收；③记录设备型号/系统版本、artifact 文件名、实际结果及截图；④对发现的问题建立最小修复提交并重新跑 CI；⑤设备阻断清零后再评估 PR #4 合并，不以构建成功作为合并的唯一依据。
- 本节记录的是 run 43162417531 实际 job 状态；不推断未返回的 artifact ID、文件大小或设备运行结果。


## 23. 前端 CI 收尾与云端/本地验收边界（2026-11-12）

- 最新复核的 Frontend Checks [Run 43164060173](https://github.com/just2512/fund-boll-ledger/actions/runs/43164060173) 已完成，两个 job 均为 completed/success：
  - Unit tests and production build：依赖、执行契约/需求矩阵、Windows/Android 升级契约、Android signing 脚本语法、单元测试、BOLL/MACD 历史复用 benchmark、TypeScript、生产构建全部成功。
  - Browser end-to-end regression：Playwright browser E2E job 成功。
- 该 run 关联代码提交 `e655841acc568ef88d424a2268832765eee43200`。随后提交的文档更新未被该 run 覆盖；不得把 run 43164060173 标成这些后续文档提交的 CI 结果。
- 本轮云端代码复核重新检查了 MACD EMA/交叉历史、160/160/100 根稳定发布门槛、BOLL(20,2) 总体标准差与版本化参考配置、同一确认序列复用、日期/收盘价对齐拒绝、BOLL/MACD 历史逐根字段，以及历史不足/不可用/无效状态区分。未发现足以支持修改公式、参数、行情源或账本结构的确定性缺陷，因此不做无依据算法改动。
- **云端已完成**：现有单测/构建/benchmark/Playwright CI 收尾；README 与 TEST_PLAN 的信息架构描述同步；验收文档和本台账补记当前 CI 与原生构建证据边界。
- **由用户本地执行**：下载并安装 Windows installer、Android ARM64 debug-only APK；检查启动、价格计算/交易账本/JSON 备份恢复回归；OPPO Find N2（PUG110）外屏/内屏、横竖屏、输入法、真实行情下 BOLL/MACD 详情和历史表格操作。结果需回填设备型号、系统版本、artifact 文件名、操作步骤、实际结果及截图。
- Android 持久签名 Release 仍 SKIPPED；debug-only APK 不可覆盖正式版。安装前先导出 JSON 备份，避免本地 IndexedDB 数据丢失。
- PR #4 仍保持 open、未合并；feature branch 相对 main ahead 130 / behind 0。当前没有授权或证据要求在本轮合并。


- 需求矩阵同步：T-09 的 currentReview/blocker 已同步本轮 Native run 43162417531 与 Frontend Checks run 43164060173 的证据边界，并明确 Windows/Android/Find N2 的本地验收责任。该矩阵更新提交晚于 Run 43164799096 的 checkout；需由本次台账提交触发的后续 CI 再验证最新 JSON 矩阵，不能把 Run 43164799096 提前记为验证该 JSON 更新。


## 2026-11-12 需求矩阵提交 CI 收口

- 需求矩阵与台账边界提交：`a2a58eabd6eb70ad8025d333e5a1ce843d28c124`。
- 后续 Frontend Checks [Run 43164881293](https://github.com/just2512/fund-boll-ledger/actions/runs/43164881293) 已完成，两个 job 均 completed/success：
  - Unit tests and production build：执行契约与 technical-state requirements matrix 检查、依赖检查、升级契约、Android signing 工具语法、单元测试、BOLL/MACD benchmark、TypeScript 与生产构建均成功。
  - Browser end-to-end regression：Playwright E2E 步骤成功。
- 该 run 由上述需求矩阵/台账提交触发，补齐此前 Run 43164799096 未覆盖最新矩阵提交的证据缺口。未取得日志中的测试数量，不推断具体通过数。
- 云端可执行的阶段 0—3 及阶段 4 自动化检查继续保持通过；设备验收不因此解除：Windows 桌面实际操作、Android 安装/启动、OPPO Find N2 外屏/内屏/横竖屏/输入法和真实行情技术详情仍由用户本地执行并保持 BLOCKED。Android 持久签名 Release 仍 SKIPPED。

## 2026-11-13 PR #6 与 main 同步、Android Insets 收敛

- 同步前 main：`bb54c71585f9ba9edac17379fec05aeb76a2520c`；同步前 PR #6 head：`33241722b974f6ce139fe079487aea9b11086cc0`。本次以 PR head 为第一父提交、main 为第二父提交创建合并同步提交，保留 PR 全部功能历史并消除 behind 提交。
- Android Insets 统一由 `scripts/configure-android-window-insets.mjs` 在 `cargo tauri android init --ci` 后动态补丁生成的 Tauri `MainActivity.kt`。main 引入的静态替换方案（`scripts/android/MainActivity.kt` 与 `scripts/apply-android-edge-to-edge.sh`）不再进入合并树，避免两套监听器/补丁方案竞争。
- Android Debug 与持久签名 Release 两个 job 均在 Android 工程初始化后执行同一 Insets 脚本；Release 不再漏掉安全区配置。正式签名仍由 `ANDROID_RELEASE_SIGNING_ENABLED` 和持久 keystore 条件控制，未配置时保持 SKIPPED。
- 合并 main 时保留 `.gitignore` 的 `backup/`，防止本地账本 JSON 备份误入版本控制。
- T-09 仍为 BLOCKED，但阻断范围已明确后置：Windows 安装包本地启动/账本/JSON 恢复，以及 OPPO Find N2 真机安装运行、外屏/内屏/横竖屏/输入法与真实行情检查均在 PR 合并后执行，不作为合并前置条件。
- **同步后准确提交验收：**前端 Frontend Checks [Run 43346104071](https://github.com/just2512/fund-boll-ledger/actions/runs/43346104071) 对应本提交，两个 job 均 completed/success：14 个测试文件通过、137 passed / 2 skipped（2 项 live-data 测试按既有设计跳过）、技术状态引擎 17/17、TypeScript 与生产构建成功，Playwright 48/48。
- **原生云端构建：**Native App Build [Run 43346104077](https://github.com/just2512/fund-boll-ledger/actions/runs/43346104077) 对应本提交，Windows desktop installer 和 Android ARM64 ephemeral-signed Debug APK 两个 job 均 completed/success。Android 的工程初始化、`Configure Android system-bar insets`、Gradle 预热、ARM64 APK 编译、Debug 签名校验及 artifact 上传全部成功；Windows 升级契约、Tauri CLI、图标、测试/桌面构建与 artifact 上传全部成功。
- **原生产物：**Windows `fund-boll-ledger-windows-x64`，artifact ID `14002402050`，SHA-256 `f993962bf28413301f73c142ffcc5641066fc25c2694cfe28aee2cfd729058fc`；Android `fund-boll-ledger-android-arm64-debug-only`，artifact ID `14002670865`，SHA-256 `f1ccb72ea9ffeecb7d18eccfc5cd3d8b027072ecb69c24d2b1be311bf2d6671b`。两个 artifact 均于 2026-11-27（UTC）到期，见 Native Run Artifacts。
- **SKIPPED：**Android ARM64 signed release（upgrade-compatible）job 因 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用而跳过；本轮不生成可覆盖升级正式版的安装包，持久签名配置与正式 APK 拉取按用户决定后置。
- **合并后本地验收：**Windows 安装包安装/启动、账本操作和 JSON 备份恢复；Android 在 OPPO Find N2（PUG110）安装运行、外屏/内屏/横竖屏/输入法/系统栏安全区和真实行情下 BOLL/MACD 检查。以上仍保持未验收，不因云端构建成功而改为 PASS，且不作为本 PR 合并前置条件。

- **最终文档 head（`60b1ebab97e5f455db77ca4ce995d1b4d0713dcb`）复验：**Frontend Checks [Run 43347936534](https://github.com/just2512/fund-boll-ledger/actions/runs/43347936534) completed/success；14 个测试文件通过，137 passed / 2 skipped（2 项 live-data 按设计跳过），technical-state engine 17/17，TypeScript、benchmark、生产构建、执行契约/需求矩阵和升级契约通过，Playwright 48/48。
- **最终 head 原生构建：**Native App Build [Run 43347936789](https://github.com/just2512/fund-boll-ledger/actions/runs/43347936789) completed/success；Windows installer 与 Android ARM64 ephemeral-signed Debug APK 构建、签名/校验和上传均成功；Android system-bar Insets 脚本在 Debug 构建中执行成功。Android persistent-signing Release 为 SKIPPED（未启用签名开关）。
- **最终 head 产物：**Windows `fund-boll-ledger-windows-x64` artifact ID `14003207044`，SHA-256 `ed4cc88c3606b44e4682a75fce3569fbddefb4964ca3171998c8e2cc9a1220ac`；Android `fund-boll-ledger-android-arm64-debug-only` artifact ID `14002229486`，SHA-256 `b9b476fab1e07df48c802d638f26e5a2cf6a61ddb2a92d54a389399c0e8a119e`。两项均于 2026-11-27（UTC）到期。
