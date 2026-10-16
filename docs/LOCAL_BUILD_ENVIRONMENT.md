# 本机构建环境实录（2026-10-16/17）

本文件记录在这台机器上把 fund-boll-ledger 构建跑通的实际环境与踩坑。重建环境时按此对照，不依赖记忆。

## Windows 桌面版（已验证可构建）

### 工具链位置（全部 D 盘，C 盘零占用）

| 组件 | 位置 |
|---|---|
| Rust 1.99.1 stable-msvc | RUSTUP_HOME=`D:\ProgramData\rustup`、CARGO_HOME=`D:\ProgramData\cargo` |
| tauri-cli 2.11.4 | `D:\ProgramData\cargo\bin\cargo-tauri.exe` |
| VS C++ Build Tools（MSVC 14.44.35207） | `D:\ProgramData\VS BuildTools` |
| Windows SDK 10.0.26100 | `C:\Program Files (x86)\Windows Kits\10`（微软固定路径，约 3G 吃 C 盘，无法改 D） |
| Node 24.14.1 | 既有 nvm4w junction（`C:\nvm4w\nodejs` → `D:\ProgramData\nodejs`） |

每次新开 shell 使用 Rust 必须：
```bash
export RUSTUP_HOME="D:\\ProgramData\\rustup" CARGO_HOME="D:\\ProgramData\\cargo" PATH="/d/ProgramData/cargo/bin:$PATH"
```

### 构建命令

```powershell
cd D:\fund-boll-ledger
cargo tauri build   # 产物：src-tauri\target\release\fund-boll-ledger.exe + bundle\nsis\*-setup.exe
```

双击 `启动基金阶梯账本.bat` 直接启动已构建的 exe。

### 踩坑实录（重建环境必读）

1. **cargo 拉 crates.io 卡死**：HTTP/2 帧被网络重置（PROTOCOL_ERROR），表现为 `Updating crates.io index` 永不结束。
   修法：`D:\ProgramData\cargo\config.toml` 已配 rsproxy.cn 镜像（sparse 协议）+ `multiplexing=false`。删这个文件就会复现卡死。
2. **tauri 2.11.5 依赖漂移**：`^` 语义把 tauri-runtime/macros/codegen 拉到 API 不兼容的新版（27 处编译错误）。
   修法：`cargo update <crate>@<新版> --precise <官方配套版>` 钉回。配套矩阵：runtime 2.11.3 / runtime-wry 2.11.4 / wry 0.55.1 / macros 2.6.3 / codegen 2.6.3 / muda 0.19.3。已锁进 Cargo.lock 提交仓库。
3. **rustup 安装中断会留残骸**：报 `missing manifest`，直接 `rustup toolchain install stable --force` 重装即可，不用删目录。
4. **GitHub push 间歇性 reset**：本网络到 443 不稳，push 失败重试几轮即可，不是配置问题。

## Android ARM64 APK（WSL 自托管 Runner）

### 环境（全部在 WSL Ubuntu 内，vhdx 落 D:\WSL\Ubuntu\ext4.vhdx）

| 组件 | 位置/版本 |
|---|---|
| 用户 | actions（HOME=/home/actions） |
| JDK | openjdk 17.0.20.1（/usr/bin/java） |
| Android SDK | ~/android-sdk（cmdline-tools、platform-tools 37.0.1） |
| platform / build-tools / NDK | android-36 / 36.0.0 / 28.2.13676358（tauri-cli 2.11.4 模板要求 compileSdk=36；早期装的 34/27.2 是错位版本，已补装对的） |
| Rust | stable + aarch64-linux-android target（~/.cargo） |
| tauri-cli 2.11.4 | ~/.cargo/bin/cargo-tauri |
| Runner | systemd 服务 actions.runner.just2512-fund-boll-ledger.wsl-fund-boll-runner.service，标签 self-hosted,Linux,X64,wsl |

### 构建（CI 手动触发）

仓库 Actions → Native App Build (manual) → Run workflow。Android job 跑在 WSL Runner 上，环境变量由工作流 GITHUB_ENV 注入（systemd 服务不吃 .profile，别指望 shell 配置）。

### 踩坑实录

1. **systemd 服务不吃 .profile**：ANDROID_HOME 等必须在 workflow 里显式 export 进 GITHUB_ENV。
2. **Windows 侧 Bash 的 $VAR 会被预展开**：写 WSL 脚本要用文件拷入（/mnt/c 路径）或 base64，不能命令行内联 export。
3. **Ubuntu .bashrc 非交互早退**：环境变量写 .profile 而不是 .bashrc。
4. **tauri-cli 模板 SDK 版本**：2.11.4 模板 compileSdk/targetSdk=36、AGP 8.11.0，SDK 组件必须 platform-36 + build-tools 36.0.0。

## 仓库根目录的 SDK 垃圾（待用户裁决）

`D:\fund-boll-ledger\` 下的 `ndk/`（2G）、`build-tools/`、`platform-tools/`、`platforms/`、`cmake/`、`licenses/` 是另一会话误装的 Windows 侧 Android SDK（约 2.3G）。已 gitignore。如确认不用 Windows 侧 Android 构建，可整目录删除；要留就挪到 D:\Android 之类独立目录。
