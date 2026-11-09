# 本地数据迁移与安装包升级

## 数据迁移与备份

- IndexedDB 数据库版本由 v1 升到 v2，只新增 `app-meta` 元数据仓库；原有 `app-state/main` 账本记录不重写、不删除。
- 迁移记录保存来源版本、目标版本和迁移时间。后续改变基金、交易或快照结构时，必须新增显式迁移步骤，不能只改 TypeScript 类型。
- 有账本数据且从未发起完整 JSON 导出时显示提醒；记录的导出发起时间达到 7 天后再次提醒。
- 提醒时间代表应用发起了下载，不代表用户已将文件保存到其他安全位置。导出后应将 JSON 复制到独立、安全的位置；CSV 不包含完整基金档案和价格快照。

## Windows NSIS 更新

当前版本统一为 `0.2.0`。以下身份必须保持不变：

- Tauri identifier：`com.just2512.fundbollledger`
- productName：`基金阶梯账本`
- NSIS installMode：`currentUser`

更新时运行新版本安装包覆盖现有用户级安装，不要先卸载旧版本。不要增加清理 WebView2 用户数据目录、IndexedDB 或应用数据目录的安装/卸载脚本。每次发布前先导出完整 JSON 备份。

`npm run verify:upgrade-contract` 会检查版本号同步、identifier、productName、NSIS 安装模式、IndexedDB 数据库/仓库身份和 Android versionCode。它是升级契约检查，不等同于已经完成 Windows 旧版安装到新版的真实覆盖安装验收；该验收仍需在 Windows 设备执行。

## Android APK 更新

Android 更新必须同时满足：

1. applicationId 保持 `com.just2512.fundbollledger`。
2. 新 APK 的 `versionCode` 高于已安装版本。本版本 `0.2.0` 对应 `versionCode=2000`。
3. 新旧 APK 使用同一签名证书。更换签名证书后，Android 不允许覆盖安装，应用数据也不会自动迁移到新包。

### 长期签名密钥

本地 release 构建首次运行 `scripts/build-android.ps1` 时，会在用户目录 `%USERPROFILE%/.fund-boll-ledger/` 创建并复用长期密钥；密钥文件和密码配置不进入 Git 仓库。不要删除、重建或覆盖该密钥。

要让 GitHub 生成同一签名的可升级 release APK：

1. 在本机先运行一次 `scripts/build-android.ps1`，生成长期签名密钥。
2. 运行 `node scripts/export-android-signing-secrets.mjs`。脚本会在用户目录生成 `github-android-signing-secrets.txt`，不会把密钥内容打印到终端。
3. 在 GitHub Repository Settings → Secrets and variables → Actions 中分别设置：
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_PASSWORD`
   - `ANDROID_KEY_ALIAS`
4. 在 Repository Variables 中设置 `ANDROID_RELEASE_SIGNING_ENABLED=true`。
5. 手动运行 Native App Build workflow。只有该长期签名 job 生成的 `release-upgradeable.apk` 才能作为后续覆盖升级包。

当前保留的 ephemeral-signed Android smoke APK 使用临时密钥，只能用于一次性安装和构建冒烟测试，**不能作为后续升级包**。旧 workflow 生成的临时签名 APK 同样无法保证与新长期密钥互相覆盖。若设备当前安装的是临时签名版本，切换到长期签名版本前必须先导出 JSON；随后可能需要卸载旧 APK、安装长期签名版本并导入 JSON。此后所有升级必须继续使用同一长期密钥。

### 实机验收

在 OPPO Find N2 上验证旧版本数据、安装新版本、启动后基金/交易/快照仍在，随后再进行一次同签名覆盖升级。此项由设备持有人完成，不阻塞网页 CI 和其他开发工作。
