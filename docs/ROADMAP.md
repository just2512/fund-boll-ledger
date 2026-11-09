# 迭代路线图

## 已有 Web MVP（现有功能）

- [x] Fund / Trade / Snapshot 数据模型和 IndexedDB 本地保存
- [x] 五个基准价、手动当前价、五基准对比
- [x] 双向 1%—10% 阶梯及越档定位
- [x] 基金档案、交易新增/编辑/删除、费用拆分
- [x] 加权平均成本、已实现/浮动盈亏
- [x] 价格快照、JSON 备份恢复、CSV 交易导出
- [x] 公式单元测试、网页 Playwright 测试初稿

## 当前分支：原生应用化

- [x] Tauri Windows 桌面窗口骨架
- [x] Tauri Android ARM64 工程构建骨架
- [x] BAT 优先启动已构建 EXE，不再打开默认浏览器
- [x] Windows NSIS 安装包构建脚本
- [x] Android ARM64 APK 构建脚本
- [x] 手动触发的 Windows / Android 构建工作流，避免 push 自动耗费 Actions 用量
- [x] 折叠屏外屏、展开内屏、横屏、桌面视口回归测试
- [x] 在 GitHub-hosted Windows 工具链上完成完整原生构建（EXE + NSIS Artifact；Actions run `42576011666`）
- [x] 在 GitHub-hosted Android API 36 环境完成 ARM64 ephemeral-signed smoke APK 构建（该临时签名仅供一次性冒烟安装，不具备覆盖升级保证；Actions run `42576011666`）
- [ ] 在 OPPO Find N2 PUG110 实机验证 Android 系统、软键盘和折叠切换
- [ ] 按真实东方财富交割单核对佣金与其他费用

## 原生验收后增强

- [x] 备份导入前验证结构、枚举、日期、价格、费用、关联 ID、交易时序与持仓；校验失败时列出具体字段原因且不替换当前账本
- [x] 交易筛选、按日期/基金/买卖方向搜索及关键词检索；跨基金编辑/删除保持原基金关联
- [x] 历史快照按同基金上一条记录展示上轨、中轨、下轨、昨收、上次成交价五个基准的绝对变化与涨跌幅；缺失值和零基准明确降级
- [x] IndexedDB v1→v2 采用只增不改的元数据迁移，保留原账本记录；本地完整 JSON 导出提醒按 7 天周期触发并持久化导出发起时间
- [x] 统一 0.2.0 版本号、Android versionCode=2000、Windows currentUser 安装身份，并加入升级契约检查
- [x] Android 长期签名密钥本地生成/复用脚本、GitHub Secrets 配置流程和可升级 release job（需配置 4 项 Secrets 与 ANDROID_RELEASE_SIGNING_ENABLED=true 后才会执行）
- [ ] Windows 旧版覆盖安装保留 IndexedDB 的真实安装验收
- [ ] Android 长期签名 release 构建、同签名覆盖升级和 OPPO Find N2 数据保留实机验收

## 明确推迟

- 云端多设备同步、账号系统、服务端备份。
- 自动行情与东方财富登录/账户接口。
- 自动交易、交易信号、策略回测。
- 自动推断不同基金或账户对应的手续费/税费。

任何同步功能都必须先明确数据授权、加密、冲突处理、删除语义和服务成本，不能将本地账本无提示上传。
