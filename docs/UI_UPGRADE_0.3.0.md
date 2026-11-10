# UI 系统版本升级记录：0.3.0

## 版本身份

- 应用版本：`0.3.0`
- Git 版本标签约定：`v0.3.0`（当前连接没有创建 Git tag 的写操作；本次以版本记录和 release checkpoint 分支留存）
- Android `versionCode`：`3000`，按现有规则 `major * 1,000,000 + minor * 1,000 + patch`
- 应用标识：`com.just2512.fundbollledger`，保持不变
- Windows NSIS 安装模式：`currentUser`，保持不变
- IndexedDB 数据库与 object store 身份：保持不变

## 回退锚点

- 升级前 main 基线：`72354042108c43d65f59ecd8f74d20baf1339d50`
- 回退分支：[`rollback/ui-v0.3.0-baseline`](https://github.com/just2512/fund-boll-ledger/tree/rollback/ui-v0.3.0-baseline)
- 回退方式：将代码检出到上述 SHA 或回退分支。不得通过卸载应用、清理 IndexedDB、降级覆盖安装等方式回退；Android 正式安装包还必须保持原持久签名身份。
- 本次升级不迁移、不重写 Fund/Trade/Snapshot 数据，也不改变 JSON 备份契约。

## 改造范围

仅在既有价格对比模块和全局顶部栏内实施：

1. 顶部行情摘要胶囊：展示当前选中基金、手动录入/刷新后的现价、来源和时间；点击展开摘要托盘。顶部栏采用轻量毛玻璃，不使用滚动驱动折射或复杂动态取色。
2. 日/周/月横向手风琴：桌面端一次展开一个周期，其他周期收窄；窄屏改为纵向折叠，避免挤压指标值。
3. 指标详情托盘：周期摘要保持可见，历史覆盖、数据来源、确认 K 线、BOLL 与 MACD 依据在下层展开。
4. 行情刷新反馈：加载、成功、失败使用不同状态；成功才出现对勾与轻微提亮；失败不得显示成功反馈。
5. 动效：使用 CSS transition/opacity/transform；尊重 `prefers-reduced-motion`；不新增动画依赖。

## 明确不做

- 不增加虚拟进度条、待办进度、重叠卡片、跟手图标、景深滚动、圆柱形变、液滴拖拽、封面取色氛围光。
- 不新增页面或独立产品模块。
- 不改变 BOLL/MACD 计算、行情来源优先级、确认 K 线规则或技术状态含义。
- 不改变 Fund/Trade/Snapshot 持久化结构、IndexedDB 身份和 JSON 备份契约。
- 不增加后台轮询、交易方向或交易建议。

## 版本字段与升级门禁

以下字段必须同步为 `0.3.0`：

- `package.json`
- `package-lock.json`（根包版本）
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`（本应用包条目）
- `src-tauri/tauri.conf.json`

Android versionCode 必须为 `3000`。升级契约脚本应以 package version 为单一版本源，校验其他版本字段和 Android versionCode；原应用 ID、Windows 安装身份、本地数据库身份及持久签名规则不得放宽。

## 验收

- 前端：执行契约、升级契约、依赖安全检查、单元测试、TypeScript、生产构建、Playwright E2E。
- 浏览器：桌面、360px 外屏、720px 内屏和横屏；顶部摘要展开、周期互斥展开、减少动效。
- 原生：Windows 安装包、Android ARM64 Debug 冒烟包和持久签名 Release 包分开验证。Debug 包不可用于覆盖升级正式签名包。
- 真机：OPPO Find N2 外屏和内屏分别验收；浏览器视口测试不得代替物理设备验收。
- 账本：升级前导出 JSON 备份；安装/升级后核对基金档案、交易、快照和导入导出。

## 状态说明

本文件记录目标版本、范围和回退点。版本号更新及代码改造提交不等于 CI、原生安装包或物理设备验收已经通过；每项以实际工作流日志和设备结果为准。
