# Execution Ledger

This file is the human-readable recovery index. The authoritative item-by-item status is **[TECHNICAL_STATE_REQUIREMENTS.json](TECHNICAL_STATE_REQUIREMENTS.json)**; do not duplicate or manually override its statuses here.

## Active scope

BOLL + MACD technical-state calculation and factual description inside the existing price-comparison module only.

Explicitly excluded: strategy backtesting, order/fill simulation, position/capital/fee/slippage/return calculations, trade instructions, new standalone pages, and ledger schema changes.

## Required reading order after any interruption or new session

1. [EXECUTION_CONTRACT.md](EXECUTION_CONTRACT.md)
2. [TECHNICAL_STATE_ANALYSIS_IMPLEMENTATION_PLAN.md](TECHNICAL_STATE_ANALYSIS_IMPLEMENTATION_PLAN.md), especially sections 24–26
3. [TECHNICAL_STATE_SOURCE_AUDIT.md](TECHNICAL_STATE_SOURCE_AUDIT.md)
4. [BOLL_MACD_CALIBRATION_REPORT.md](BOLL_MACD_CALIBRATION_REPORT.md)
5. [TECHNICAL_STATE_REQUIREMENTS.json](TECHNICAL_STATE_REQUIREMENTS.json)
6. Current main commit, working tree, latest frontend CI, latest technical-state calibration run, and native build/device acceptance status

Do not continue from chat memory alone. Reconcile the matrix with the actual current source and CI before changing any status.

## Completion rule

A requirement is PASS only when its current implementation, acceptance tests and traceable evidence are present. A green CI run does not automatically close every requirement. Any item without evidence remains MISSING, UNKNOWN, IN_PROGRESS or BLOCKED. Never delete a requirement to make the matrix green.

## Current implementation boundaries

- BOLL uses the explicit daily/weekly/monthly descriptive reference configuration in `src/technical-state/config.ts`; it is not a trading threshold or optimized strategy.
- MACD status is not published before the empirical confirmed-history minimum: daily 160, weekly 160, monthly 100 bars.
- Historical replay uses confirmed-bar prefixes and checks for future-data leakage.
- The UI remains inside the existing price-comparison module; details are collapsible.
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
