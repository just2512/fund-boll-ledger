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
