# B 线：MACD 状态审计与适配任务交接

基线：契约冻结后的 `main`。
共享契约：`docs/TECHNICAL_STATE_COMPUTATION_CONTRACT.md`、`src/technical-state/types.ts`。

## 责任范围

审计并扩展现有 `src/macd.ts`，不重写已有 MACD 算法。优先让正式计算核心接受 `ConfirmedTechnicalSeries`，保留现有调用兼容性。

## 必须完成

- [ ] 逐项核对 MACD(12,26,9)、EMA seed、35 根最低输出门槛及 320 根历史窗口语义。
- [ ] 区分 DIF/DEA 排列、零轴位置、最近一次交叉、本根新交叉和柱体动能。
- [ ] 修正/澄清旧版 `summarizeMacdPeriods` 的“三周期偏多/偏空”语义，避免将 DIF 零轴位置等同于完整多空排列；如保留旧文案，需明确其只是零轴位置摘要并保持兼容。
- [ ] 新增基于 `ConfirmedTechnicalSeries` 的纯计算入口；不在 MACD 内重复实现收盘确认和日期规范化。
- [ ] 验证交叉事件只发生在当根确认 K 线，后续不重复。
- [ ] 增加 EMA 起点敏感性、预热、零轴穿越、相等边界、动能增强/减弱、历史不足和数据源切换测试。

## 禁止事项

- 不修改 BOLL 状态引擎或 `src/market-data.ts`。
- 不新增行情请求。
- 不擅自更改 EMA seed 或 MACD 公式；如认为必须更改，先用独立对照测试证明并保留旧算法兼容性。
- 不开发 UI，不修改账本 schema。

## 交付

完善 `src/macd.ts` 和 `src/macd.test.ts`，公开结构化状态输出，保持旧调用兼容。提交前运行 `npm run test`、`npm run build`，修复真实失败并保留日志。该分支 push 会触发 Frontend Checks。
