# A 线：BOLL 状态引擎任务交接

基线：契约冻结后的 `main`。
共享契约：`docs/TECHNICAL_STATE_COMPUTATION_CONTRACT.md`、`src/technical-state/types.ts`。

## 责任范围

只实现 BOLL 历史状态纯计算和单元测试。输入必须是 `ConfirmedTechnicalSeries`；不得自行处理实时行情、K 线请求、日/周/月收盘过滤或 UI。

## 必须完成

- [ ] 实现 BOLL(20,2) 历史轨道计算，使用总体标准差，内部保留未舍入精度。
- [ ] 计算 BBW 及 1/3/5 根变化。
- [ ] 按显式 `BollStateConfig` 计算带宽经验分位；禁止前视。
- [ ] 计算中轨方向、走平、持续方向和转折；所有阈值来自显式配置。
- [ ] 计算历史收盘相对当根轨道的位置；允许超出 0%-100%。
- [ ] 数据不足、配置非法、轨道宽度为零/中轨无效时返回明确 validity/reason。
- [ ] 编写边界、分位、拐头、数据不足、确定性和前视隔离测试。

## 禁止事项

- 不修改 MACD 公式或 `src/macd.ts`。
- 不修改 `src/market-data.ts`、行情请求、账本类型和 UI。
- 不把现价覆盖值混入历史确认序列。
- 不自行硬编码未冻结阈值；配置未提供时输出 UNKNOWN/INSUFFICIENT。
- 不修改或删除既有测试来适配实现。

## 交付

新增独立 `boll-state.ts` 及测试；导出纯函数，输入/输出遵守共享类型。提交前运行 `npm run test`、`npm run build`，修复真实失败并保留日志。该分支 push 会触发 Frontend Checks。
