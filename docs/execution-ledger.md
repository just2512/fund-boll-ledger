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

The frontend browser CI and multi-ETF live calibration are recorded in the requirement matrix. `.github/workflows/native-build.yml` is manual-only; no Windows installer or Android APK was built in this execution, and no physical-device test is claimed. Trigger that workflow separately when native package artifacts are required.

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
- 当前代码与专项测试提交：891b63f8422844387b05339b05808d402868b106（历史计算复用实现位于其祖先提交，性能基准脚本位于 b5d229b4261ef0885244e270922590ce8437840f）。
- 最近完整前端 CI：Run [43153256086](https://github.com/just2512/fund-boll-ledger/actions/runs/43153256086)，14 个测试文件通过，134 passed / 2 skipped；benchmark、TypeScript、生产构建、执行契约和升级契约通过；Playwright 47/47 通过。
- 已消除每周期快照中重复的 BOLL 全历史点计算和 MACD 全历史序列构建；复用历史序列前校验长度、日期和收盘价，并通过等价性与错位拒绝测试。没有改变 BOLL/MACD 公式、EMA 初始化、确认 K 线、稳定发布门槛或历史事件语义。
- 1,000 根日线的单次 CI 基准：BOLL 从 296.43 到 356.55 ops/s（1.20x）；MACD 从 1,277.39 到 2,269.16 ops/s（1.78x）。Vitest bench 是实验性基准，单次 GitHub-hosted runner 数据不能外推为物理设备性能。
- 已补充 UI 异常路径：没有确认历史时显示“无可确认历史 K 线”；K 线三源失败显示 UNAVAILABLE 和源端失败原因；现价源全部失败时摘要显示真实错误；保留旧行情时明确提示“上次成功数据”。
- 账本隔离复核：Fund、Trade、PriceSnapshot、AppData 不包含技术状态；MarketQuote.technicalState 只作为行情响应的临时派生字段，JSON 导出序列化的是 AppData，未改动持久化 schema。
- PR #4 仍 open、未合并；当前分支相对 main behind 0。不得擅自合并。
- 外部阻断保持：Windows Tauri、Android ARM64 和 OPPO Find N2 真机验收未执行；两个 live-data 测试仍 skipped，不计 PASS。
