# 技术状态分析源码审计

- 审计日期：2026-11-09
- 代码基线：用户指定回退基线 `8bdb64a85f4dec5360400315915960791589566d`
- 当前审计提交：`961c4363210c9cd231f53fc8cebfe927fd9106dc`
- 范围：现有价格对比模块中的 BOLL + MACD 技术状态描述；不包含策略回测、订单、成交或账本扩展。

## 1. 行情与确认 K 线

| 文件/入口 | 实际职责 | 审计结论 |
|---|---|---|
| `src/market-data.ts:fetchLatestQuote` | 东方财富现价优先；失败后尝试百度现价 | 百度现价没有可信交易日期时，不允许用于确认技术状态 |
| `src/market-data.ts:fetchIntervalHistory` | 东方财富日/周/月 K 线优先，失败后百度 K 线 | 保留来源，不静默混合 |
| `src/technical-state/series.ts` | 日期、重复记录、周期归一化和收盘确认 | 技术状态只接收已确认 K 线 |
| `src/market-data.ts:fetchIntervalIndicators` | 将确认序列送入 BOLL + MACD 引擎 | 当前已按 daily/weekly/monthly 注入 BOLL 参考配置 |

## 2. BOLL

- `src/technical-state/boll-state.ts`：复用 BOLL(20,2) 和总体标准差口径，计算轨道、BBW、分位、带宽阶段、中轨方向和确认收盘位置。
- `src/technical-state/config.ts`：生产调用使用版本 `reference-2026-11-09` 的显式周期配置。
- `src/technical-state/config.test.ts`：验证生产配置与真实行情敏感性报告中的 `anchor-reference-only` 候选一致。
- 配置定位是描述性参考基线，不是交易阈值，也没有进行收益优化。真实行情报告仍标记 `thresholdSelection: NOT_PERFORMED`。
- 未配置时引擎输出 UNKNOWN；生产行情路径当前传入明确配置，不再把 UNKNOWN 当作完成。

## 3. MACD

- `src/macd.ts`：MACD(12,26,9)，EMA、DIF、DEA、HIST、交叉、排列、零轴和柱体动能。
- 数学计算下限仍是 35 根；技术状态发布另有经验稳定性门槛：日线 160 根、周线 160 根、月线 100 根。
- 稳定性门槛来自 4 只 ETF × 3 个周期的滚动历史起点敏感性；门槛用于避免短历史造成状态分类漂移，不代表交易有效性。
- `src/technical-state/engine.ts` 在确认历史不足时不发布 MACD 状态，避免把数学上可计算的早期值误当作稳定状态。

## 4. 组合描述与多周期

- `src/technical-state/engine.ts:describeTechnicalStateSnapshot`：单周期 BOLL + MACD 结构化描述。
- `src/technical-state/engine.ts:describeTechnicalMultiTimeframeState`：按月、周、日分别陈述 BOLL 带宽阶段、中轨方向、MACD DIF 零轴位置和新交叉事件；不合成为买卖方向。
- `src/technical-state/engine.test.ts`：覆盖阈值未配置时保持 UNKNOWN、跨周期描述和稳定历史门槛。

## 5. 历史重放

- `src/technical-state/history-replay.ts`：按确认 K 线前缀逐根重放，并比较最终批量结果。
- 实时校准测试逐标的、逐周期运行完整前缀重放，并检查 no-future-bars。
- 历史状态不写入 Fund/Trade/Snapshot 账本结构。

## 6. 现有 UI

- `src/App.tsx:MacdPanel`：仍位于现有价格对比模块内，标题调整为 BOLL + MACD 技术状态。
- 首屏显示跨周期客观描述；日/周/月详细依据折叠在同一面板内。
- `MacdPeriodCard` 展示 BOLL 轨道、BBW、历史分位、阶段、中轨方向、确认收盘位置，以及 MACD 状态。
- `src/styles.css` 提供窄屏折叠和卡片布局；`e2e/app.spec.ts`、`e2e/foldable.spec.ts` 覆盖展开/收起和多视口宽度。

## 7. 账本隔离和范围排除

- `src/storage.ts`、`src/types.ts` 与用户指定回退基线的 blob SHA 完全一致，未改变 Fund/Trade/Snapshot 持久化结构。 `src/App.tsx` 与 `src/market-data.ts` 本轮有修改，但仅用于现有价格对比模块展示和注入派生技术状态，没有新增持久化字段或改写交易记录。
- 当前 main 不存在 `src/backtest/`、回测工作流或回测 npm script。
- `src/technical-state/boll-macd-events.ts` 是既存研究辅助代码，不接入当前 UI、实时校准验收或买卖流程。
- 当前交付不包含策略回测、订单、成交、资金、费用、滑点、收益或交易指令。

## 8. 真实数据与 CI 证据

- 多 ETF 真实校准成功 Run：[42646038809](https://github.com/just2512/fund-boll-ledger/actions/runs/42646038809)。4 只 ETF（510300、510500、159915、512100）× 日/周/月，共 12 组；Eastmoney/Baidu K 线来源策略无违规；Eastmoney 现价来源策略无违规；逐根重放通过。
- 该报告的 `thresholdSelection` 仍是 `NOT_PERFORMED`，生产只采用参考配置，不宣称已找到唯一最优阈值。
- 真实校准报告中的百度备用 K 线探针返回 2001 根；百度现价探针没有可信交易日期，因此不作为技术状态的现价日期依据。
- 当前前端单测、类型检查、生产构建和浏览器 E2E 以最新 main CI 结果为准；运行中的任务不得提前标记通过。

## 9. 尚存边界

- BOLL 参考配置可运行且经过真实历史敏感性对照，但不是收益优化后的参数，也不应被解释为交易信号。
- 多周期摘要是逐项事实并列，不输出综合涨跌结论。
- 任何真实行情服务故障必须保留原始失败状态，不通过跳过用例或更换未授权来源掩盖。
