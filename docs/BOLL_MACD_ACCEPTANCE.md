# BOLL + MACD 技术状态验收标准

> 本文是 `docs/BOLL_MACD_INFORMATION_ARCHITECTURE.md` 的配套强制验收清单。未通过的条目必须标记为 FAIL、MISSING 或 BLOCKED；不得用“基本完成”替代。

- 适用模块：基金价格计算页 BOLL + MACD 技术状态
- 设计依据：`docs/BOLL_MACD_INFORMATION_ARCHITECTURE.md`
- 既有公式：`docs/DATA_AND_FORMULAS.md`
- 校准依据：`docs/BOLL_MACD_CALIBRATION_REPORT.md`

## 1. 验收状态定义

- **PASS**：有自动化测试、真实数据或可复核 UI 证据支持。
- **FAIL**：与约束冲突，或测试证明行为错误。
- **MISSING**：实现/证据尚不存在。
- **BLOCKED**：依赖外部环境、真实设备或数据源，当前无法完成。
- 不允许把 MISSING/BLOCKED 记为 PASS。
- 每项记录测试命令、测试用例/设备、结果和对应提交 SHA。

## 2. 第一层：首屏摘要

- [x] 默认可见日线、周线、月线，顺序固定。
- [x] 每个周期独立显示一句自然语言概括。
- [x] 每个周期内 BOLL 与 MACD 分区表达，不混淆指标归属。
- [x] 不再显示按指标维度串联三个周期的长段落。
- [x] 不把 BOLL/MACD 有效周期数量作为首屏主体。
- [x] 只压缩已计算字段，不在文案层推断交易方向。
- [x] 历史不足、无效、不可用和未知明确显示原因。
- [x] 一项指标有效、另一项不可用时，分别显示，不得整体误报为有效或不可用。

## 3. 第二层：周期详情与交互

- [x] 默认选中日线。
- [x] 日线详情在默认状态下直接可见，无需额外点击。
- [x] 点击周线/月线一次即可直接显示该周期完整详情。
- [x] 不存在外层周期 details + 内层指标 details 双重折叠。
- [x] 周期详情不使用抽屉、弹窗或二次嵌套展开；历史明细单独使用一层默认折叠区块。
- [x] BOLL、MACD、来源与计算元数据分区清楚（包含公式版本与 BOLL 配置版本）。
- [x] MACD 展示真实 DIF、DEA、柱体值。
- [x] BOLL 展示参数版本、上中下轨、BBW、历史分位、样本数、带宽阶段、中轨方向、确认收盘通道位置。
- [x] MACD 展示参数、DIF/DEA/柱体、零轴、排列、动能、本根交叉。
- [x] 最近一次历史交叉（如有）与本根新交叉分开显示。
- [x] K 线源和现价源分开显示。
- [x] 展示确认日期、历史起止、确认 K 线数、进行中 K 线排除信息。
- [x] 展示 MACD EMA 快慢线/信号线种子策略、种子日期、实际输入历史长度及额外历史长度。
- [x] 无法取得的元数据明确显示“未提供”，不猜测。

## 4. 第三层：真实历史序列

- [x] 每个周期存在逐根历史计算结果，日期与原始确认 K 线一一对应。
- [x] BOLL 每根至少包含日期、收盘、上轨、中轨、下轨、BBW、分位、阶段、中轨方向、通道位置百分比和位置分类。
- [x] MACD 每根至少包含日期、收盘、DIF、DEA、柱体、零轴、排列、动能、当根交叉；最新历史行与 BOLL 日期一致且公式字段非预热/未知。
- [x] 历史明细默认折叠，用户点击一次即可展开。
- [x] 展开后默认显示最近 20 根已确认 K 线。
- [x] 可用数据不足 20 根时展示实际数量，不补造。
- [x] 更早数据可通过分页或日期范围查看，不需二次折叠。
- [x] 预热期、样本不足、状态未确认和配置缺失分别显示明确状态及原因，不填零冒充。
- [x] 最近金叉/死叉日期来自真实逐根历史事件。
- [x] 当前排列、带宽阶段和中轨方向的起始日期遵循设计文档的状态确认定义，并同时展示 N 根确认观察窗口起点。
- [x] 历史数据不写入基金账本、交易记录和 JSON 备份。

## 5. 计算正确性与时间因果

- [x] BOLL 与 MACD 使用同一批确认 K 线。
- [x] 日/周/月进行中 K 线均按既有确认规则排除。
- [x] 无可信交易日期的现价不进入技术历史序列。
- [x] 对每个周期执行逐根前缀重放。
- [x] 完整批量计算结果与逐根重放最后结果一致。
- [x] 追加未来 K 线后，过去所有确认日期的 BOLL/MACD 数值和状态不变。
- [x] 历史交叉事件与逐根 DIF/DEA 穿越关系一致。
- [x] 历史序列每一行的指标值只使用该日期及之前的 K 线。
- [x] 沿用现有 BOLL(20,2)、总体标准差、版本化参数配置。
- [x] 沿用 MACD(12,26,9)、EMA 初始化规则及现有状态发布历史门槛；没有经批准的参数变更。
- [x] 数值格式化只发生在展示层，不能反向参与指标计算。

## 6. 状态与边界测试矩阵

| 场景 | BOLL 预期 | MACD 预期 | UI 预期 |
|---|---|---|---|
| 三周期均有效 | 分周期展示真实状态 | 分周期展示真实状态 | 三周期摘要完整 |
| BOLL 有效、MACD 历史不足 | BOLL 正常 | MACD 显示不足门槛和实际数量 | 不误报周期整体有效 |
| MACD 有效、BOLL 无效 | BOLL 显示原因 | MACD 正常 | 指标独立呈现 |
| 两指标均历史不足 | 显示不足 | 显示不足 | 不显示伪造数值/事件 |
| 输入数据无效 | INVALID + 原因 | 若输入共享则不可用；不得绕过输入校验 | 明确数据无效 |
| 数据源失败 | UNAVAILABLE/INVALID 按现有契约 | 同左 | 保留真实失败原因 |
| 进行中日线 | 排除未确认 K 线 | 排除未确认 K 线 | 显示最后确认日期 |
| 进行中周线/月线 | 周/月整根排除 | 周/月整根排除 | 不以周中/月底前时间冒充收盘 |
| 历史交叉存在 | 不相关 | 最近交叉日期与本根交叉分开 | 日期可追溯 |
| 历史范围内无交叉 | 不相关 | 明确“当前加载范围内未发现” | 不伪造日期 |
| 交叉历史不足 | 不相关 | 显示未知/范围不足 | 不显示“无交叉” |
| 状态确认根数不足 | 未知 | 未知 | 不默认走平/中性 |

## 7. UI 与设备验收

### 自动化视口

- [x] Playwright 使用 240/180/120 根确认历史覆盖默认日线、周线/月线切换、EMA 元数据、历史 20 根分页、无二次折叠和 390px 窄屏滚动（由 Frontend Checks Run 43215324077 的 Playwright 48/48 验证）。
- [x] 验证选中周期详情默认可见。
- [x] 验证周期详情没有二次嵌套展开；历史明细仅一层且默认关闭（Frontend Checks Run 43215324077，Playwright 48/48）。
- [x] 验证表格横向滚动只发生在表格容器，不造成页面整体横向溢出（由 Frontend Checks Run 43162737208 的 Playwright 48/48 验证）。
- [x] 验证窄屏下摘要、详情和历史表格不重叠、不裁切关键状态（由 Frontend Checks Run 43162737208 的 Playwright 48/48 验证）。
- [x] 验证刷新前后状态日期、来源和数据一致（run 515 Playwright 通过）。

### Windows

- [x] `npm run test`
- [x] `npm run build`
- [x] `npx playwright test`
- [x] Windows Tauri 原生构建（Native workflow Run [43155823629](https://github.com/just2512/fund-boll-ledger/actions/runs/43155823629)，Windows desktop installer job 成功并上传 artifact；桌面窗口实际检查仍 BLOCKED）。
- [BLOCKED] 桌面窗口实际检查默认日线详情、周期切换和历史表格。

### Android

- [x] Android ARM64 APK 构建与临时 debug 签名（Native workflow Run [43155823629](https://github.com/just2512/fund-boll-ledger/actions/runs/43155823629)，Build ARM64 APK、apksigner verify 和 artifact 上传均成功；该 APK 不可用于正式版覆盖升级）。
- [BLOCKED] OPPO Find N2 外屏检查。
- [BLOCKED] OPPO Find N2 展开内屏检查。
- [BLOCKED] 竖屏、横屏、输入法弹出后页面可操作。
- [BLOCKED] 真机历史表格不导致整个页面横向溢出或明显卡顿。
- [x] 真机未执行时标记 BLOCKED，不以模拟器/浏览器视口替代真机结论。

## 8. 回归保护

- [x] 价格计算、十档阶梯、交易记账、持仓盈亏、快照、JSON 导入导出、CSV 导出测试无回归。
- [x] 技术状态仍为派生数据，不进入持久化账本。
- [x] 行情刷新仍为用户主动触发，不新增后台轮询。
- [x] 行情源回退顺序与来源可信度约束不变。
- [x] 不新增交易 API、券商连接或自动下单。
- [x] 不删除/放宽既有测试以通过 CI。

## 9. 阶段完成门槛

- 阶段 0：两份文档已提交，README 有链接，文档内容与既有公式/校准口径一致。
- 阶段 1：摘要规则和状态边界测试全部 PASS。
- 阶段 2：周期详情交互、内容字段和 E2E 检查全部 PASS。
- 阶段 3：真实逐根历史序列、前缀重放、no-future-bars、批量一致性全部 PASS。
- 阶段 4：本文件中可执行项全部 PASS；依赖真实设备的项目必须单独标 BLOCKED，不能宣称整体设备验收完成。

每阶段结束时更新本文的验收记录，写明提交 SHA、测试命令和结果。阶段未通过不得进入“已完成”状态；允许在不掩盖阻断项的前提下继续处理其他独立问题。


## 10. 本轮执行记录（2026-11-12）

- 代码分支：`work/technical-state-information-architecture`
- 计算与数据管线提交：`574f9163a83e505c690b90e2dcce9895cb3d7475`
- GitHub Actions：<https://github.com/just2512/fund-boll-ledger/actions/runs/43144982080>
- 单元测试：14 个测试文件通过，130 项通过，2 项跳过，0 项失败。
- TypeScript 检查与生产构建：通过。
- Playwright：43 项通过（1.6 分钟）。
- 执行契约、Windows/Android 升级契约和 Android signing 脚本语法检查：通过。
- 两项跳过测试是实时行情校准/验收测试；本轮没有声称完成实时数据源验收。
- **BLOCKED**：Windows Tauri 原生构建与 Android ARM64 debug-only 原生构建已由 Native workflow Run 43162417531 完成；Windows 桌面实际操作、Android 安装/启动及 OPPO Find N2 外屏/内屏真机检查仍未执行。浏览器视口通过不能替代这些设备验收。
- 第二层真实数值显示、第三层历史表格在有真实行情数据时的视觉核对，仍需使用真实设备/数据补验；不能仅凭静态代码和无行情状态的 E2E 断言其完整通过。

阶段 0—3 的自动化实现与计算门槛已通过本轮 CI。阶段 4 的自动化部分通过，原生构建与真机部分保持 BLOCKED；整体不得标记为全部验收完成。


## 11. 后续复核记录（2026-11-12）

- 当前分支已同步 main 的两个新增历史计算测试；通过双父提交纳入主线，PR 不再落后于 main，当前 GitHub 状态为 mergeable_state=clean。
- BOLL 历史状态新增“首次确认日期”和“N 根确认观察窗口起点”两个独立字段；当前周期详情分别展示带宽阶段与中轨方向的确认日期、观察窗口起点。
- MACD 详情补充快慢线/信号线 EMA 种子策略、种子日期、实际输入根数及超过公式最低 35 根的额外历史长度；即使状态因稳定门槛显示“历史不足”，也仍展示已确认输入元数据。
- 修正结构化详情文案：MACD 的 insufficient-history、unavailable、invalid-data 分别显示“历史不足”“数据不可用”“数据无效”，不再将历史不足误写成数据不可用。
- 新增 Playwright 场景：240/180/120 根日/周/月确认历史，覆盖默认日线详情、周/月单击切换、EMA 元数据、20 根分页、无二次折叠及 390px 窄屏表格内滚动。
- 新增/合并测试：BOLL 状态确认观察窗口、MACD 三类可用性文案；保留主线新增的 BOLL/MACD 历史日期对齐测试。
- 当前 head：d57e62416d9889776ad18958d6303f928978d090（合并主线测试后的双父提交）。
- CI 证据边界：run 496 为 PASS，但其实际执行提交为 65486fefff184be428f9152d6578bab348c0dd7e，早于本记录中的后续 engine/UI/E2E 修改；因此不能将 run 496 记作当前 head 的完整验证。当前 head 的新测试仍待新的 GitHub Actions run 验证。
- 尚未通过当前 head CI 的 UI/交互条目继续保持未勾选；Windows Tauri、Android ARM64 和 OPPO Find N2 真机项仍为 BLOCKED。


## 12. CI 复核与修复（2026-11-12）

- run 497（执行提交 `d57e62416d9889776ad18958d6303f928978d090`）：单元测试 14 个文件通过、132 项通过、2 项 live 测试跳过；TypeScript 检查与生产构建通过。
- run 497 的 Playwright 新增窄屏用例执行到最终尺寸断言时失败。失败原因是 `page.evaluate()` 返回 DOM 元素，跨浏览器上下文序列化后不是可读取 `scrollWidth/clientWidth` 的 HTMLElement；此前页面宽度断言、历史表格行数、分页和周期切换断言均已通过。
- 已修复：只从页面上下文返回 `tableScrollWidth`、`tableClientWidth` 两个数值，不再返回 DOM 元素。修复提交：`8e79d6593a42744faaffc678a814448ed632f694`。
- run 498 在修复提交前启动，不能作为该修复的验证；后续以包含修复提交的 CI 结果为准。当前 head 的 UI/E2E 项继续保持未验收状态，直到相应 run 完成。


## 13. 历史 BOLL 通道位置字段补齐（2026-11-12）

- 复核第三层逐根字段时发现：历史数据模型已有 `closeLocationPercent`，但 BOLL 历史表格只显示位置分类，没有显示对应百分比，无法逐行核对通道位置计算值。
- 已补齐历史表格两列：`通道位置 %` 与 `位置分类`；新增 Playwright 断言验证最新历史行两列均有真实值。代码提交：`e3fd819f9d44d27b922be6f50be380a122b3273d`；E2E 提交：`aa2ff1781377f35ed21c3f13eb110a15aecc2ec8`。
- 此项仍待包含上述提交的 CI 通过后标记 PASS。


## 14. 逐根历史数值验收补强（2026-11-12）

- BOLL 历史表已补齐逐根通道位置百分比和位置分类，避免只有标签、缺少可复核数值。
- Playwright 新增最新 BOLL/MACD 历史行断言：逐根数值不为空/非预热，日期与两指标一致，并验证当前 MACD DIF、DEA、柱体真实数值及最近交叉元数据。
- 相关实现提交：`e3fd819f9d44d27b922be6f50be380a122b3273d`；E2E 断言提交：`32e78f61ae2a228bd5a688bfceb9f5231b1675ba`；正则转义修复提交：`62ff4f9853632cc8090669ac13e2505e67f0bbfd`。
- 上述 E2E 加强尚未有包含最终提交的 CI 结果，继续保持待验收。


## 15. BOLL 状态日期快照一致性（2026-11-12）

- 补充引擎级回归断言：当前 BOLL 快照的阶段确认日期、N 根观察窗口起点、中轨方向确认日期和观察窗口起点，必须逐字段等于最新一根 BOLL 历史点的对应字段。
- 测试提交：`81c2f8e8448fe820001436fdb9a1bf92410bc505`。待包含该提交的单测/构建 CI 通过后标记 PASS。


- CI 跟进：run 505（提交 `62ff4f9853632cc8090669ac13e2505e67f0bbfd`）已完成，单测/构建与 44 项 Playwright 均 PASS，包含逐根 BOLL 通道位置及 MACD 实际数值断言。run 506 当前执行提交为 `722537732b7f5f8be8104cabfe189620b2f60ebb`，尚未包含后续引擎级日期一致性测试提交 `81c2f8e8448fe820001436fdb9a1bf92410bc505`；该新增断言仍需后续 CI 覆盖。


## 16. 指标公式版本元数据补齐（2026-11-12）

- 复核发现：此前 UI 有 BOLL 参数版本，但没有独立的 BOLL/MACD 公式版本字段；与设计文档要求的公式版本元数据不完全一致。
- 已新增统一公式版本 `technical-formula-v1`，语义固定为当前 BOLL(20,2) 总体标准差与 MACD(12,26,9) EMA 递推/种子规则；正常与不可用快照均携带该版本，周期详情单独展示。
- 已补充引擎单测和 Playwright 元数据断言；实现提交：`b518d8c6bc8e880b0e96f9b7b8fc8032521fcb08`。待包含该提交的 CI 通过后标记 PASS。


## 17. 历史不足与少于 20 根的界面边界测试（2026-11-12）

- 扩展真实确认历史 Playwright 用例，切换同一行情刷新为 100/100/80 根，验证 MACD 明确显示“历史不足”、仍展示真实 EMA 种子日期与输入长度，且不误报“数据不可用”。
- 再切换为 12/12/12 根，验证 BOLL/MACD 历史表各展示实际 12 行，分页文案为 1/1 页，不补齐成 20 行。
- 同时验证 K 线源与现价源分别展示、BOLL 参数版本可见。E2E 提交：`1b851e860887c498785c7ce220e000b7763b7c6e`；待当前测试提交 CI 完成后标记 PASS。


- CI 修复记录：run 510 单测/构建通过；新增 100 根历史状态断言时，Playwright 因页面摘要与状态标签重复包含“MACD 历史不足”而触发 strict-mode 多元素错误，并非产品状态错误。已将定位改为 `exact: true`，修复提交：`c0d80cc513f2da530198f3716ff486d7eb80b444`。下一轮需继续验证 12 根短历史断言。


- CI 复核补充：run 512 的单测/构建 PASS；Playwright 在第 1 个既有空状态测试的 page fixture 初始化阶段超时（30 秒），尚未执行本轮新增状态断言。该失败发生于浏览器启动/页面 fixture setup，不是新增断言失败；当时多个历史 run 的 E2E job 并发。需在队列空闲后重跑当前代码提交，不能将 run 512 记为产品回归失败或通过。


## 18. 当前指标细节与刷新一致性补强（2026-11-12）

- Playwright 补充断言：BOLL 当前上/中/下轨、带宽、历史分位、样本数、阶段、中轨方向和收盘通道位置均显示；MACD 当前本根交叉、排列开始日期、动能及最近历史交叉分别显示。
- 对同一组确定性行情重复手动刷新，校验最新 BOLL 日期、MACD DIF 与行情来源保持一致，覆盖刷新前后状态稳定性。
- E2E 提交：`f551faf9be597d078c5ff301afc2f3e36a3a8caa`；待后续 CI 通过后勾选对应验收项。


## 19. 自动化验收状态更新（2026-11-12）

- run 513：14 个测试文件通过、132 项通过、2 项 live tests 跳过；Playwright 44 项通过，包含 100 根 MACD 历史不足与 12 根实际行数测试。
- run 514：单测/构建通过，Playwright 44 项通过；但其执行 head 为 `413a48fc61067200cdbc19f896941b2d31913930`，早于当前新增的当前指标细节/重复刷新一致性 E2E 提交 `f551faf9be597d078c5ff301afc2f3e36a3a8caa`。因此第 7 节“刷新前后状态一致”暂不勾选，需后续 run 覆盖该测试提交。
- 当前自动化已验证：公式版本、BOLL 参数版本、BOLL/MACD 当前与历史数值、交叉日期、确认窗口日期、来源分离、短历史行数、分页、窄屏容器滚动和旧业务回归。
- Windows Tauri、Android ARM64 和 OPPO Find N2 设备项均明确标记 BLOCKED；2 个实时行情 live tests 仍为 skipped，不计入 PASS。


## 20. 当前自动化验收收口（2026-11-12）

- run 515：单元测试 14 个文件通过、132 项通过、2 项 live tests 跳过；TypeScript 检查、生产构建、执行契约检查通过；Playwright 44 项全部通过。
- 本轮新增 E2E 当前指标细节与重复刷新一致性断言通过；同时通过 240/180/120 根周期数据、100 根 MACD 历史不足、12 根短历史行数、分页、历史值日期对齐、390px 窄屏表格滚动等场景。
- 自动化可执行项已全部勾选 PASS；2 个真实行情 live tests 仍 skipped，不计入实时行情验收。Windows Tauri、Android ARM64 和 OPPO Find N2 真机项目继续 BLOCKED。
- 验证提交：`f551faf9be597d078c5ff301afc2f3e36a3a8caa`；当前分支最新文档提交为本记录，未合并 PR。


## 18. 异常数据展示与重复计算复核（2026-11-12）

- **PASS**：calculateTechnicalStateSnapshot 复用同一份 BOLL/MACD 历史序列构造当前快照。此前 BOLL 历史与当前状态分别调用 calculatePoints，MACD 历史与当前状态分别调用 buildMacdHistory；现改为历史序列计算一次后传入快照构造器。复用入口同时核对历史长度、日期和收盘价；不一致时 fail closed。
- **PASS**：新增 BOLL/MACD 复用前后结果等价测试，以及日期错位拒绝测试；保留既有逐根前缀重放、批量一致和 no-future-bars 测试。
- **PASS**：无确认 K 线时 UI 显示“无可确认历史 K 线”，不再把 excludedInProgressBar=false 误表达为“仅使用已确认收盘数据”。
- **PASS**：K 线三源全部失败时，周期详情显示 UNAVAILABLE、失败原因、K 线来源“未提供”和现价来源；全部现价源失败时，技术摘要显示实际失败原因。若刷新失败但保留上次成功行情，摘要明确标注所展示的是上次成功数据。
- 性能基准：新增 technical-state.bench.ts，并在 frontend-checks CI 中运行 npm run bench:technical-state。以 1,000 根已确认日线为输入，Vitest 单次 GitHub-hosted runner 读数：BOLL 两次计算 296.43 ops/s、均值 3.3734 ms；复用历史 356.55 ops/s、均值 2.8047 ms（1.20x）。MACD 两次计算 1,277.39 ops/s、均值 0.7828 ms；复用历史 2,269.16 ops/s、均值 0.4407 ms（1.78x）。这是单次 CI 基准，Vitest bench 为实验性功能；数据仅说明该 runner 上的计算路径差异，不代表 Windows/Android/OPPO 设备性能。
- GitHub Actions Run [43153256086](https://github.com/just2512/fund-boll-ledger/actions/runs/43153256086)，提交 891b63f8422844387b05339b05808d402868b106：14 个单测文件通过，134 项通过、2 项实时行情测试跳过；benchmark、TypeScript 检查、生产构建、执行契约和升级契约通过；Playwright 47 项全部通过。
- 早期异常 UI E2E 的 strict locator 断言曾因摘要和详情中存在多个相同文案而失败；已将断言限定在 .macd-summary。另一次浏览器 CI 的首个 page fixture 在 30 秒内未启动，其他 45 项通过；最新 Run 43153256086 的 47 项全部通过。失败运行保留，不覆盖历史。
- **BLOCKED**：Windows Tauri 原生构建、Android ARM64 原生构建和 OPPO Find N2 外屏/内屏真机验收仍无执行证据。浏览器 E2E 通过不替代这些验收。

- **PASS（真实数据复验）**：专用 Live Technical Acceptance and Multi-ETF Calibration Run [43153956310](https://github.com/just2512/fund-boll-ledger/actions/runs/43153956310)，提交 4bf0c5e892e41888fda106b551cb9c9218ddbe05，第二次 attempt 成功。510300 日/周/月实时验收 1/1 通过；4 只 ETF × 3 周期共 12 组、7,351 根确认 K 线，全部 noFutureBars=true、逐根最终结果与批量结果一致，sourcePolicy.violations=[]。东方财富为 12 组主 K 线/现价来源；另行强制回退探针实际取得百度 K 线 2,000 根，百度报价解析到价格 4.153 和昨收 4.150，但无可信交易日期，因此不参与技术状态日期确认。thresholdSelection 继续 NOT_PERFORMED。
- 首次真实校准 attempt 因百度直连 HTTP 403、CDN 代理超时失败；保留该失败记录，第二次 attempt 重新执行后通过。不得将首次失败删除或写成从未发生。

- **PASS（持久化边界）**：Playwright Run [43154771624](https://github.com/just2512/fund-boll-ledger/actions/runs/43154771624) 中新增 E2E：行情刷新后 BOLL/MACD 技术状态可见，但 JSON 备份仅包含 funds、schemaVersion、snapshots、trades，不含 technicalState/formulaVersion。该测试验证导出边界；IndexedDB 持久化结构仍以 AppData 类型和存储调用链审计为依据。


## 2026-11-12 原生构建复验（工作分支）

- **PASS：Windows 原生构建**。Native App Build Run [43155823629](https://github.com/just2512/fund-boll-ledger/actions/runs/43155823629)，Windows desktop installer job 全步骤成功，artifact `fund-boll-ledger-windows-x64` 已上传（artifact ID `13917120140`，保留至 2026-11-26）。
- **PASS：Android ARM64 smoke APK 构建与临时签名**。同一 run 的 ARM64 Rust/Gradle 构建、debug keystore 生成、zipalign、apksigner sign/verify 和 artifact 上传均成功；artifact `fund-boll-ledger-android-arm64-debug-only`（ID `13916337229`，保留至 2026-11-26）。
- 失败原因与修复：前一 run [43154632857](https://github.com/just2512/fund-boll-ledger/actions/runs/43154632857) 中 APK 已编译、签名和验证成功，但复制目标文件名包含分支路径片段，父目录不存在导致 `cp` 失败。提交 [5604bcde85929144ee2b4ba9cae69790dafb78cc](https://github.com/just2512/fund-boll-ledger/commit/5604bcde85929144ee2b4ba9cae69790dafb78cc) 改为平面文件名；后续 run 43155823629 验证通过。
- Android 持久签名 Release job 因 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用而跳过；没有生成可覆盖升级的正式 APK。不得把 debug APK 当作升级包。
- **BLOCKED：**Windows 安装后桌面窗口实际检查、Android 安装/启动和 OPPO Find N2 外屏/内屏/横竖屏/输入法真机检查仍未执行。CI 原生构建通过不等于设备验收通过。
- 最新前端 CI [Run 537](https://github.com/just2512/fund-boll-ledger/actions/runs/43155831276) 在当前 head `5604bcde85929144ee2b4ba9cae69790dafb78cc` 上成功：单元测试/benchmark/类型检查/生产构建/执行契约 job 与 Playwright E2E job 均通过。


## 21. 多规模性能与技术状态重载隔离复验（2026-11-12）

- 验证提交：`d43773ff0ece483f68d861994e41d9f0fb401d14`。
- GitHub Actions [Run 43162737208](https://github.com/just2512/fund-boll-ledger/actions/runs/43162737208)：14 个单测文件通过，134 passed / 2 skipped；执行契约、升级契约、TypeScript、生产构建和 benchmark 均通过；Playwright 48/48 通过。
- **PASS：技术状态不跨页面重载持久化。** 新增 E2E 在真实行情生成技术状态后执行 reload，验证账本现价仍从本地保存恢复，但技术状态摘要回到“刷新行情后计算”、周期详情提示刷新后获取，公式版本不再出现；再次手动刷新后技术状态重新生成。该行为与 `marketQuotes` 仅为 React 内存状态、`AppData` 不包含行情派生状态的源码调用链一致。
- **PASS：多规模性能基准执行。** 同一 GitHub-hosted runner、合成已确认序列、Vitest 单次测量；单位为每次计算均值 ms：

| 历史根数 | BOLL 两次独立计算 | BOLL 历史复用 | MACD 两次独立计算 | MACD 历史复用 |
|---:|---:|---:|---:|---:|
| 240 | 0.3547 | 0.3218 | 0.1066 | 0.0564 |
| 1,000 | 1.7950 | 1.6550 | 0.4113 | 0.2272 |
| 2,000 | 3.2752 | 3.5596 | 0.7922 | 0.5005 |
| 5,000 | 11.5878 | 10.6351 | 1.9937 | 1.1930 |

- 解释边界：MACD 在四档基准中均显示复用路径耗时较低；BOLL 的差异较小且不稳定，2,000 根这一档复用路径反而更慢。本次不据此追加算法优化，也不把单次云端合成数据基准外推为 Windows/Android/OPPO 真机性能。行情源常规日线历史上限约 1,000 根，2,000/5,000 根仅作为压力测试。
- 先前两次 CI 失败已保留：第一次暴露 benchmark 测试来源值不符合 `TechnicalQuoteSource` 联合类型；修正后，E2E 又指出周期详情标题即使无行情也会保留，因此不能用标题存在与否判断技术状态是否持久化。最终断言改为检查摘要占位文案、详情提示和公式版本，当前 Run 43162737208 已通过。
- T-09 仍 **BLOCKED**：浏览器 E2E 与原生构建不等于 Windows 桌面实际操作或 OPPO Find N2 真机验收。Android 持久签名 Release 未启用，debug APK 不可覆盖正式版。


## 12. 原生构建复核更新（2026-11-12）

- Native workflow [Run 43162417531](https://github.com/just2512/fund-boll-ledger/actions/runs/43162417531) 的 Windows desktop installer job：**PASS**。步骤覆盖依赖安装、升级契约、Tauri CLI、图标生成、测试/桌面构建和 artifact 上传，全部成功。
- 同一 run 的 Android ARM64 ephemeral-signed smoke APK job：**PASS**。Android SDK/NDK、Rust ARM64 target、Gradle、APK 构建、debug keystore 签名、apksigner 验证和 artifact 上传全部成功。
- Android ARM64 signed release job：**SKIPPED**，原因是仓库变量 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用；没有可用于覆盖升级的持久签名 APK。
- 上述结果只更新原生构建项，不改变设备验收状态：Windows 桌面实际操作、Android 安装/启动、OPPO Find N2 外屏/内屏/横竖屏/输入法和真实行情下的技术详情核对继续 **BLOCKED**。不得将 CI 构建成功解释为设备验收通过。
- 当前文档修改提交之后，仍需由后续 CI 对文档/代码 head 进行验证；本节记录的是 run 43162417531 对其实际构建提交的 job 结果，不宣称验证了本次文档更新提交。


## 2026-11-12 前端 CI 后续复核（Run 43164060173）

- GitHub Actions [Run 43164060173](https://github.com/just2512/fund-boll-ledger/actions/runs/43164060173) 已完成：
  - **PASS：Unit tests and production build**，包括依赖锁定/补丁版本、执行契约与技术状态需求矩阵、Windows/Android 升级契约、Android signing 工具语法、单元测试、BOLL/MACD 历史复用 benchmark、TypeScript 检查和生产构建。
  - **PASS：Browser end-to-end regression**，Playwright browser E2E job completed/success。
- 该 run 关联提交 `e655841acc568ef88d424a2268832765eee43200`；其后的文档提交（包括 TEST_PLAN、验收记录更新）不属于该 run 的验证范围。因此只把该 run 作为该提交代码与测试的 CI 证据，不宣称验证了后续文档提交。
- 本次未获得该 run 的 Playwright 用例数明细，不在文档中推断具体通过数量。
- Android 持久签名 Release 仍因 `ANDROID_RELEASE_SIGNING_ENABLED` 未启用而 SKIPPED；debug-only APK 不可用于正式版覆盖升级。
- **BLOCKED（由本地执行）**：Windows 安装后实际桌面操作、Android 安装/启动、OPPO Find N2 外屏/内屏/横竖屏/输入法及真实行情详情核对。云端任务不代替用户设备测试。


## 2026-11-12 最新需求矩阵提交 CI 复核（Run 43164881293）

- 验证提交：`a2a58eabd6eb70ad8025d333e5a1ce843d28c124`（需求矩阵 T-09 的 currentReview/blocker 与执行台账边界同步）。
- GitHub Actions [Run 43164881293](https://github.com/just2512/fund-boll-ledger/actions/runs/43164881293)：两个 job 均 completed/success。
  - **PASS：Unit tests and production build**。锁定依赖、补丁依赖、执行契约与 technical-state requirements matrix、Windows/Android 升级契约、Android signing 工具语法、单元测试、BOLL/MACD 历史复用 benchmark、TypeScript 检查和生产构建步骤全部成功。
  - **PASS：Browser end-to-end regression**。Playwright browser E2E 步骤成功。
- 本次 run 是对前一轮尚未被 CI 覆盖的需求矩阵/台账提交的后续验证；未取得 job 日志中的测试数量明细，因此不补写单测或 E2E 通过数量。
- 本次 run 不改变外部验收边界：Windows 桌面实际安装/操作、Android 安装/启动及 OPPO Find N2 外屏/内屏/横竖屏/输入法/真实行情详情核对仍 **BLOCKED**；Android 持久签名 Release 仍 **SKIPPED**。浏览器 CI 与云端构建不得替代真机验收。


## 合并后 main 最终云端复核（2026-11-12）

- 基线提交：`0bd0d2ce8b960d9357ff48053c7dc2924080127c`（PR #4 已 squash merge 至 main）。
- **PASS：前端 CI** [Run 43166497217](https://github.com/just2512/fund-boll-ledger/actions/runs/43166497217)，run attempt 2。单元测试/生产构建与浏览器 E2E 两个 job 均 completed/success。首次 attempt 的浏览器 E2E 有 1 项既有空状态用例在 30 秒内超时；仅重跑失败的 E2E job 后通过。首次失败记录保留，不将其改写为从未发生，也不据此认定产品缺陷。
- **PASS：真实行情验收与多 ETF 校准** [Run 43166497187](https://github.com/just2512/fund-boll-ledger/actions/runs/43166497187)，对应同一 main 提交，completed/success。4 ETF × 3 周期共 12 组、7,351 根确认 K 线；全部 `noFutureBars=true`，逐根最终结果与批量计算一致，主源策略违规 0。百度 K 线备用探针取得 2,000 根；百度现价无可信交易日期，正确排除在技术状态确认之外。阈值选择为 `NOT_PERFORMED`，不代表完成交易参数优化。
- **PASS：云端验收范围**：除物理设备项外，当前需求矩阵 T-00 至 T-08、T-10、T-11 均为 PASS；前端自动化和真实行情验收已在合并后的 main 提交上完成。
- **BLOCKED：T-09 物理设备专项**：Windows 桌面安装后的实际操作、Android 安装/启动、OPPO Find N2（PUG110）外屏/内屏、横竖屏、输入法及真实行情下详情核对仍待本地执行。浏览器 E2E 和云端原生构建不能替代该项。Android 持久签名 release 仍未启用；debug-only APK 不可作为正式版覆盖升级包。
- 本次仅同步已有验收证据与状态，不增加产品功能、算法范围或测试范围；历史失败记录与 `NOT_PERFORMED` 结论均保留。


## 21. 用户确认的界面修订（2026-11-12）

- 顶部行情胶囊仅保留简洁的多周期总体反馈；完整的日/周/月 BOLL 与 MACD 描述放回价格对比模块，按周期分段。
- 历史计算明细改为单层默认折叠，点击一次展开；每页仍只显示最近 20 根，不改变计算数据和分页口径。
- BOLL 历史行中的状态标签必须区分“预热”（BOLL 20 根计算窗口未形成）、“未确认”（参数存在但状态窗口未满足确认条件）和“未配置”（确实缺少参数配置）。
- 顶部摘要点击外部区域或按 Escape 自动关闭；右侧刷新按钮复用既有手动行情刷新函数。
- Android 原生端需处理 status bar 与 display cutout insets；浏览器安全区 CSS 不替代 Android 原生窗口 inset 处理。真机验收仍须单独执行。
