# 数据模型与计算公式

## 价格百分比

给定当前价格 `C`、基准价 `B`：

- 涨跌额：`C − B`
- 涨跌幅：`(C − B) / B × 100%`（仅当 B > 0）
- BOLL 上轨、中轨、下轨、昨日收盘价和上一次成交价是五个独立基准。
- **BOLL 区间位置**：`(当前价格 − BOLL 下轨) / (BOLL 上轨 − BOLL 下轨)`。界面按比值 × 100% 展示；下轨是 0%，上轨是 100%，高于上轨会超过 100%，低于下轨会小于 0%。现价或轨道缺失、上轨不高于下轨时显示待输入。
- 行情刷新仅由用户点击触发。东方财富优先、腾讯兜底获取现价和昨收；BOLL 使用东方财富不复权日线按 BOLL(20,2) 计算。现价、昨收、上中下轨仍可手动修改。

## 阶梯价格

给定基准 `B`、方向 `d`、刻度 `n`：

- `d = up`：`B × (100+n)/100`
- `d = down`：`B × (100−n)/100`
- `n = 1..10`
- 最后舍入到 `tickSize` 的整数倍。默认 tick 为 0.001 元，按基金规则可改。

档位定位：上涨档在 `currentPrice >= stepPrice` 时标记已越过；下跌档在 `currentPrice <= stepPrice` 时标记已越过。第一档未越过的项目显示为下一档。

## 成交金额与费用

- `grossCents = round(price × quantity × 100)`
- `feeCents = commission + transferFee + stampDuty + otherFee`（各字段已用分存储）
- `feesChecked` 记录用户是否对照实际成交记录核对费用；未核对并不自动阻止记账，但必须在 UI 明确展示。
- 买入现金支出：`grossCents + feeCents`
- 卖出现金净收入：`grossCents − feeCents`

费用固定规则：佣金率为 `0.015%`，其他费用率为 `0.004%`，全局统一适用于所有基金，不按单只基金设置。两项均直接基于成交金额计算，并四舍五入到小数点后两位。新交易录入成交价和数量后自动估算佣金与其他费用；经手/过户等费用、印花税按实际发生填写。估算值不能替代东方财富实际成交记录，用户可以核对后修正本笔金额。

## 加权平均成本

- 买入：`positionQty += buyQty`；`costBasis += buyGross + buyFees`
- 卖出前成本分摊：`allocatedCost = costBasis × sellQty / positionQty`，按分四舍五入；若全部卖出，分摊全部剩余成本。
- 卖出已实现盈亏：`sellGross − sellFees − allocatedCost`
- 卖出后：`positionQty -= sellQty`；`costBasis -= allocatedCost`
- 当前参考市值：`currentPrice × positionQty`
- 浮动盈亏：`currentMarketValue − remainingCostBasis`

首版不考虑红利、拆分、合并、基金份额转换、申赎、非交易过户、转托管及不同会计方法。若持有份额因这些事件发生变化，需要在后续版本中设计独立事件模型，不能伪装成普通买卖。

## 输入规则

- 价格 > 0 才允许生成有效计算/成交。
- 数量必须为正整数份。
- 手续费非负。
- 缺失价格使用空字符串，不能用 0 代表“未知”。
- 交易按成交时间升序重算；任一卖出在该时点超过持仓，则拒绝保存。
