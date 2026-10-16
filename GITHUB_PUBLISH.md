# 发布到 GitHub

当前交付包包含完整项目源代码，但由于当前执行环境的 GitHub 连接没有“创建新仓库”的操作，本次无法替你创建远端仓库。项目已提供 Windows PowerShell 发布脚本。

## 一次性准备

1. 安装 Git for Windows 与 GitHub CLI（`gh`）。
2. 在 PowerShell 登录 GitHub：

   ```powershell
   gh auth login
   ```

3. 解压项目包，切换到 `fund-boll-ledger` 项目根目录。

## 创建仓库并推送

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\publish-to-github.ps1
```

脚本默认尝试创建 `just2512/fund-boll-ledger` **私有仓库**，初始化本地 Git、创建首个提交并推送 `main`。如果同名仓库已存在，脚本会尝试推送到该仓库。

若希望代码公开，先打开 `scripts/publish-to-github.ps1`，把 `gh repo create` 命令中的 `--private` 改为 `--public`。不要将个人交易数据或真实账本备份提交到代码仓库；本项目默认不会把 IndexedDB 内容写入文件。

## 推送后克隆

```powershell
git clone https://github.com/just2512/fund-boll-ledger.git
cd fund-boll-ledger
npm install
npm run test
npm run build
npm run dev
```
